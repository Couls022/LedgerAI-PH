/**
 * LedgerAI PH — Automated Production Installer Compiler & Packaging Suite
 * Builds genuine Windows PE NSIS setup executables:
 * 1. LedgerAI-PH-Client-Setup.exe (Production Client Accounting System)
 * 2. LedgerAI-PH-KeyGenerator-Setup.exe (Internal Authority Key Generator System)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import esbuild from 'esbuild';
import * as resedit from 'resedit';
import { generateAllIcons } from './generate-icons.js';

const ROOT_DIR = process.cwd();
const RELEASE_DIR = path.join(ROOT_DIR, 'release-installers');
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log('========================================================================');
console.log('       LEDGERAI PH — PRODUCTION WINDOWS INSTALLER BUILD PIPELINE        ');
console.log('========================================================================');

// Guard against non-Windows cloud browser containers
if (process.platform !== 'win32' && !process.env.FORCE_WINDOWS_PACKAGING) {
  console.log('\n[NOTICE] Cloud / Browser Development Environment Detected (Platform: ' + process.platform + ').');
  console.log('Native Windows PE / NSIS installer compilation (.exe) requires a local Windows environment');
  console.log('or a Windows CI runner with native binary toolchains (resedit, wine/makensis).');
  console.log('\nPermitted in this cloud environment:');
  console.log('  ✔ Application compilation (`npm run build`)');
  console.log('  ✔ Authority build (`npm run authority:build`)');
  console.log('  ✔ TypeScript linting (`npm run lint`)');
  console.log('  ✔ Automated test verification (`npm test`)');
  console.log('\nTo package Windows .exe installers, clone the repository to a local Windows machine and execute:');
  console.log('  npm run build:installers');
  console.log('========================================================================\n');
  process.exit(0);
}

// 1. Ensure clean release output directory
if (!fs.existsSync(RELEASE_DIR)) {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
}

// Remove old broken installer files if present
const clientSetupExe = path.join(RELEASE_DIR, 'LedgerAI-PH-Client-Setup.exe');
const keyGenSetupExe = path.join(RELEASE_DIR, 'LedgerAI-PH-KeyGenerator-Setup.exe');

if (fs.existsSync(clientSetupExe)) fs.unlinkSync(clientSetupExe);
if (fs.existsSync(keyGenSetupExe)) fs.unlinkSync(keyGenSetupExe);

// 2. Ensure assets exist and contain valid 256x256 multi-resolution ICO resources
const ASSETS_DIR = path.join(ROOT_DIR, 'packaging/windows/assets');
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

function ensureValidIcons() {
  const appIco = path.join(ASSETS_DIR, 'app-icon.ico');
  const keyIco = path.join(ASSETS_DIR, 'keygenerator-icon.ico');

  function isIcoValid(icoPath) {
    if (!fs.existsSync(icoPath)) return false;
    try {
      const buf = fs.readFileSync(icoPath);
      const iconFile = resedit.Data.IconFile.from(buf);
      return iconFile.icons.length >= 1 && iconFile.icons.some(i => i.data.isIcon());
    } catch {
      return false;
    }
  }

  if (!isIcoValid(appIco) || !isIcoValid(keyIco)) {
    console.log('Generating valid resedit-compatible multi-resolution Windows ICO assets...');
    generateAllIcons(ROOT_DIR);
  }
}

ensureValidIcons();

// Clean stale dist & dist-authority bundles before compiling so old assets never leak into ASAR
console.log('\n[0/6] Cleaning stale dist and dist-authority build artifacts...');
try {
  fs.rmSync(path.join(ROOT_DIR, 'dist'), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT_DIR, 'dist-authority'), { recursive: true, force: true });
} catch (e) {}

// 3. Step 1: Build Client Production Distribution
console.log('\n[1/6] Building Production Client Distribution (Frontend & Backend)...');
execSync(`${NPM_BIN} run build`, { stdio: 'inherit', cwd: ROOT_DIR });

// Build Electron main process files for Client
console.log('  Building Client Electron main entry points...');
esbuild.buildSync({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  outExtension: { '.js': '.cjs' },
  outdir: 'dist'
});

// 4. Step 2: Build Key Generator Distribution
console.log('\n[2/6] Building Internal Authority Distribution (UI & Authority Server)...');
execSync(`${NPM_BIN} run authority:build`, { stdio: 'inherit', cwd: ROOT_DIR });

console.log('  Building Key Generator server and Electron main entry points...');
esbuild.buildSync({
  entryPoints: ['internal/authority-server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  outfile: 'dist-authority/authority-server.cjs'
});

esbuild.buildSync({
  entryPoints: ['electron/authority-main.ts', 'electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  outExtension: { '.js': '.cjs' },
  outdir: 'dist-authority'
});

// Copy icons directly into dist and dist-authority
const appIcoPath = path.join(ASSETS_DIR, 'app-icon.ico');
const keyIcoPath = path.join(ASSETS_DIR, 'keygenerator-icon.ico');
if (fs.existsSync(appIcoPath)) {
  fs.copyFileSync(appIcoPath, path.join(ROOT_DIR, 'dist', 'favicon.ico'));
  fs.copyFileSync(appIcoPath, path.join(ROOT_DIR, 'dist', 'app-icon.ico'));
}
if (fs.existsSync(keyIcoPath)) {
  fs.copyFileSync(keyIcoPath, path.join(ROOT_DIR, 'dist-authority', 'favicon.ico'));
  fs.copyFileSync(keyIcoPath, path.join(ROOT_DIR, 'dist-authority', 'keygenerator-icon.ico'));
}

// 5. Step 3: Strict Pre-Installer Security Audit on Client Dist
console.log('\n[3/6] Running Security Audit on Client Distribution (Strict Isolation Verification)...');

function runSecurityAudit() {
  const distDir = path.join(ROOT_DIR, 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error('dist directory does not exist for security audit');
  }

  function getAllFiles(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(getAllFiles(fullPath));
      } else {
        results.push(fullPath);
      }
    }
    return results;
  }

  const allFiles = getAllFiles(distDir);
  const privKeyMatches = [];
  const createSignMatches = [];
  const authRouteMatches = [];
  const forbiddenFileMatches = [];
  const forbiddenFilenameRegex = /(authority|keys\.json|credentials|generator|\.pem$|\.key$)/i;

  for (const filePath of allFiles) {
    const relPath = path.relative(ROOT_DIR, filePath);
    const baseName = path.basename(filePath);

    if (forbiddenFilenameRegex.test(baseName)) {
      forbiddenFileMatches.push(relPath);
    }

    if (/\.(js|cjs|mjs|html|json|css|txt|map)$/i.test(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('BEGIN PRIVATE KEY')) {
          privKeyMatches.push(relPath);
        }
        if (/\bcreateSign\s*\(/.test(content)) {
          createSignMatches.push(relPath);
        }
        if (content.includes('/api/authority')) {
          authRouteMatches.push(relPath);
        }
      } catch (err) {}
    }
  }

  if (privKeyMatches.length > 0) {
    throw new Error(`SECURITY VIOLATION: Private key found in client dist:\n${privKeyMatches.join('\n')}`);
  }
  console.log('  ✔ Check A: grep "BEGIN PRIVATE KEY" -> 0 matches');

  if (createSignMatches.length > 0) {
    throw new Error(`SECURITY VIOLATION: createSign found in client dist:\n${createSignMatches.join('\n')}`);
  }
  console.log('  ✔ Check B: grep "createSign" -> 0 matches');

  if (authRouteMatches.length > 0) {
    throw new Error(`SECURITY VIOLATION: /api/authority endpoint found in client dist:\n${authRouteMatches.join('\n')}`);
  }
  console.log('  ✔ Check C: grep "/api/authority" -> 0 matches');

  if (forbiddenFileMatches.length > 0) {
    throw new Error(`SECURITY VIOLATION: Authority files found in client dist:\n${forbiddenFileMatches.join('\n')}`);
  }
  console.log('  ✔ Check D: find dist (authority/keys/generator) -> 0 matches');
}

runSecurityAudit();

// Clean unpacked cache directories before building
try {
  fs.rmSync(path.join(ROOT_DIR, 'release-installers', 'client-unpacked'), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT_DIR, 'release-installers', 'keygenerator-unpacked'), { recursive: true, force: true });
} catch (e) {}

// 6. Step 4: Rebuild native addons for Electron ABI and build Client Installer using real electron-builder NSIS
console.log('\n[4/6] Rebuilding native addons for Electron ABI and compiling Standalone Client Windows NSIS Installer (LedgerAI-PH-Client-Setup.exe)...');
execSync(`${NPX_BIN} electron-builder install-app-deps`, { stdio: 'inherit', cwd: ROOT_DIR });
execSync(`${NPX_BIN} electron-builder --config electron-builder.client.json --win`, { stdio: 'inherit', cwd: ROOT_DIR });

// Clean win-unpacked cache between builds so electron-builder doesn't conflict on executable naming
try {
  fs.rmSync(path.join(ROOT_DIR, 'release-installers', 'win-unpacked'), { recursive: true, force: true });
} catch (e) {}

// 7. Step 5: Build Key Generator Installer using real electron-builder NSIS
console.log('\n[5/6] Compiling Internal Key Generator Windows NSIS Installer (LedgerAI-PH-KeyGenerator-Setup.exe)...');
execSync(`${NPX_BIN} electron-builder --config electron-builder.keygenerator.json --win`, { stdio: 'inherit', cwd: ROOT_DIR });

console.log('========================================================================');
console.log('✔ BOTH WINDOWS NSIS INSTALLERS SUCCESSFULLY BUILT VIA ELECTRON-BUILDER!');
console.log(`  1. Client Installer:        ${clientSetupExe}`);
console.log(`  2. Key Generator Installer: ${keyGenSetupExe}`);
console.log('========================================================================');
