import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { paths } from './paths';
import { getCompanyVanityDomain } from '../../shared/vanityDomainUtils';

const execFileAsync = promisify(execFile);

export interface GenerateLauncherResult {
  success: boolean;
  exePath?: string;
  exeName?: string;
  message?: string;
  skipped?: boolean;
}

export class CompanyLauncherGenerator {
  private static findCscPath(): string | null {
    const candidates = [
      'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
      'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
      'C:\\Windows\\Microsoft.NET\\Framework64\\v3.5\\csc.exe',
      'C:\\Windows\\Microsoft.NET\\Framework\\v3.5\\csc.exe',
    ];

    for (const c of candidates) {
      if (fsSync.existsSync(c)) {
        return c;
      }
    }
    return null;
  }

  private static findIconPath(): string | null {
    const candidates = [
      path.resolve(process.cwd(), 'packaging/windows/assets/app-icon.ico'),
      path.resolve(process.cwd(), 'public/favicon.ico'),
    ];

    for (const c of candidates) {
      if (fsSync.existsSync(c)) {
        return path.resolve(c);
      }
    }
    return null;
  }

  public static sanitizeExeName(rawName: string): string {
    const clean = rawName
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    return clean || 'Company Workspace';
  }

  /**
   * Generates a lightweight, native Windows GUI launcher (<CompanyName>.exe) inside the company directory.
   * When double-clicked by the user:
   * 1. Detects or launches the local LedgerAI PH server background process.
   * 2. Automatically registers the company folder into the server shortcuts.
   * 3. Opens the user's default browser directly to the company's login page.
   */
  public static async generateLauncher(params: {
    companyDirectory: string;
    companyId: string;
    legalName: string;
  }): Promise<GenerateLauncherResult> {
    const { companyDirectory, companyId, legalName } = params;

    if (process.platform !== 'win32') {
      return {
        success: false,
        skipped: true,
        message: 'Launcher executable compilation is only supported on Windows host environments.',
      };
    }

    if (!companyDirectory || !fsSync.existsSync(companyDirectory)) {
      return {
        success: false,
        message: `Company directory '${companyDirectory}' does not exist on disk.`,
      };
    }

    const cscPath = this.findCscPath();
    if (!cscPath) {
      return {
        success: false,
        message: 'Windows C# compiler (csc.exe) not found on host.',
      };
    }

    const safeExeName = `${this.sanitizeExeName(legalName || companyId)}.exe`;
    const targetExePath = path.join(companyDirectory, safeExeName);
    const iconPath = this.findIconPath();
    const vanityDomain = getCompanyVanityDomain({ id: companyId, legalName });

    const tempCsPath = path.join(
      os.tmpdir(),
      `launcher-${crypto.randomBytes(6).toString('hex')}.cs`
    );

    const csSource = `using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace LedgerAI.CompanyLauncher
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                string companyDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\\\', '/');
                string manifestPath = Path.Combine(companyDir, "manifest.json");
                string companyId = ${JSON.stringify(companyId)};
                string legalName = ${JSON.stringify(legalName)};

                if (File.Exists(manifestPath))
                {
                    try
                    {
                        string json = File.ReadAllText(manifestPath, Encoding.UTF8);
                        string parsedId = ExtractJsonField(json, "id");
                        if (!string.IsNullOrEmpty(parsedId)) companyId = parsedId;
                        string parsedName = ExtractJsonField(json, "legalName");
                        if (!string.IsNullOrEmpty(parsedName)) legalName = parsedName;
                    }
                    catch { }
                }

                int[] candidatePorts = new int[] { 3000, 65170, 8080, 5000 };
                int activePort = -1;

                // Probe candidate ports for active LedgerAI PH Server
                for (int attempt = 0; attempt < 3; attempt++)
                {
                    foreach (int p in candidatePorts)
                    {
                        if (ProbePort(p))
                        {
                            activePort = p;
                            break;
                        }
                    }
                    if (activePort != -1) break;

                    if (attempt == 0)
                    {
                        TryStartServer();
                    }
                    Thread.Sleep(1500);
                }

                if (activePort == -1)
                {
                    activePort = 3000;
                }

                // Register this company folder directly into server shortcuts
                RegisterFolder(activePort, companyDir);

                // Open default browser directly to company login page with client vanity domain
                string vanityDomain = ${JSON.stringify(vanityDomain)};
                string targetUrl = string.Format("http://localhost:{0}/#/client/{1}/login", activePort, Uri.EscapeDataString(vanityDomain));
                Process.Start(new ProcessStartInfo
                {
                    FileName = targetUrl,
                    UseShellExecute = true
                });
            }
            catch { }
        }

        static bool ProbePort(int port)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}/api/health", port));
                req.Timeout = 600;
                req.Method = "GET";
                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    return (int)resp.StatusCode == 200;
                }
            }
            catch
            {
                return false;
            }
        }

        static void RegisterFolder(int port, string folderPath)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}/api/companies/open-folder", port));
                req.Timeout = 3000;
                req.Method = "POST";
                req.ContentType = "application/json";
                string jsonBody = "{\\"path\\":" + QuoteJson(folderPath) + ",\\"conflictResolution\\":\\"FAIL_ON_CONFLICT\\"}";
                byte[] bytes = Encoding.UTF8.GetBytes(jsonBody);
                req.ContentLength = bytes.Length;
                using (var stream = req.GetRequestStream())
                {
                    stream.Write(bytes, 0, bytes.Length);
                }
                using (var resp = (HttpWebResponse)req.GetResponse()) { }
            }
            catch { }
        }

        static void TryStartServer()
        {
            try
            {
                string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string[] candidates = new string[]
                {
                    Path.Combine(localApp, "Programs", "LedgerAI PH Client", "LedgerAI PH Client.exe"),
                    Path.Combine(localApp, "Programs", "LedgerAI-PH-Client", "LedgerAI PH Client.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "LedgerAI PH Client", "LedgerAI PH Client.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "LedgerAI PH Client", "LedgerAI PH Client.exe")
                };

                foreach (string candidate in candidates)
                {
                    if (File.Exists(candidate))
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = candidate,
                            UseShellExecute = true
                        });
                        break;
                    }
                }
            }
            catch { }
        }

        static string QuoteJson(string s)
        {
            return "\\"" + s.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"") + "\\"";
        }

        static string ExtractJsonField(string json, string field)
        {
            string needle = "\\"" + field + "\\"";
            int idx = json.IndexOf(needle, StringComparison.OrdinalIgnoreCase);
            if (idx == -1) return "";
            int colon = json.IndexOf(':', idx + needle.Length);
            if (colon == -1) return "";
            int startQuote = json.IndexOf('"', colon);
            if (startQuote == -1) return "";
            int endQuote = json.IndexOf('"', startQuote + 1);
            if (endQuote == -1) return "";
            return json.Substring(startQuote + 1, endQuote - startQuote - 1);
        }
    }
}
`;

    try {
      await fs.writeFile(tempCsPath, csSource, 'utf8');

      const args = [
        '/nologo',
        '/target:winexe',
        '/optimize+',
        `/out:${targetExePath.replace(/\//g, '\\')}`,
      ];

      if (iconPath && fsSync.existsSync(iconPath)) {
        args.push(`/win32icon:${iconPath.replace(/\//g, '\\')}`);
      }

      args.push(tempCsPath.replace(/\//g, '\\'));

      await execFileAsync(cscPath, args);

      return {
        success: true,
        exePath: targetExePath,
        exeName: safeExeName,
        message: `Compiled native company launcher '${safeExeName}' successfully.`,
      };
    } catch (err: any) {
      console.error(`Failed to compile launcher for ${companyId}:`, err);
      return {
        success: false,
        message: err?.message || 'Error compiling launcher executable.',
      };
    } finally {
      try {
        if (fsSync.existsSync(tempCsPath)) {
          await fs.unlink(tempCsPath);
        }
      } catch {}
    }
  }

  /**
   * Automatically iterates through all known active companies and shortcuts,
   * ensuring that their company folder contains an up-to-date <CompanyName>.exe launcher.
   */
  public static async syncLaunchersForKnownCompanies(): Promise<{
    generated: number;
    errors: number;
    results: Array<{ companyId: string; exeName?: string; success: boolean }>;
  }> {
    const results: Array<{ companyId: string; exeName?: string; success: boolean }> = [];
    let generated = 0;
    let errors = 0;

    const companiesRoot = paths.getCompaniesRootDir();
    if (!fsSync.existsSync(companiesRoot)) {
      return { generated: 0, errors: 0, results: [] };
    }

    try {
      const entries = await fs.readdir(companiesRoot, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const compDir = path.join(companiesRoot, ent.name);
        const manifestFile = path.join(compDir, 'manifest.json');
        let companyId = ent.name;
        let legalName = ent.name;

        if (fsSync.existsSync(manifestFile)) {
          try {
            const raw = await fs.readFile(manifestFile, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.id) companyId = parsed.id;
            if (parsed.legalName) legalName = parsed.legalName;
          } catch {}
        }

        const res = await this.generateLauncher({
          companyDirectory: compDir,
          companyId,
          legalName,
        });

        if (res.success) {
          generated++;
          results.push({ companyId, exeName: res.exeName, success: true });
        } else if (!res.skipped) {
          errors++;
          results.push({ companyId, success: false });
        }
      }
    } catch (err) {
      console.error('Error syncing company launchers:', err);
    }

    return { generated, errors, results };
  }
}
