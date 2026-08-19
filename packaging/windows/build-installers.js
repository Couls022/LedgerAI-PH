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

console.log('========================================================================');
console.log('       LEDGERAI PH — PRODUCTION WINDOWS INSTALLER BUILD PIPELINE        ');
console.log('========================================================================');

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

// 3. Step 1: Build Client Production Distribution
console.log('\n[1/6] Building Production Client Distribution (Frontend & Backend)...');
execSync('npm run build', { stdio: 'inherit', cwd: ROOT_DIR });

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
execSync('npm run authority:build', { stdio: 'inherit', cwd: ROOT_DIR });

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

// 5. Step 3: Strict Pre-Installer Security Audit on Client Dist
console.log('\n[3/6] Running Security Audit on Client Distribution (Strict Isolation Verification)...');

function runSecurityAudit() {
  // A. Check for private key strings in client dist
  try {
    const privKeyMatch = execSync('grep -rn "BEGIN PRIVATE KEY" dist/ || true', { cwd: ROOT_DIR }).toString().trim();
    if (privKeyMatch) {
      throw new Error(`SECURITY VIOLATION: Private key found in client dist:\n${privKeyMatch}`);
    }
    console.log('  ✔ Check A: grep "BEGIN PRIVATE KEY" -> 0 matches');
  } catch (e) {
    if (e.message.includes('SECURITY VIOLATION')) throw e;
  }

  // B. Check for createSign in client dist
  try {
    const createSignMatch = execSync('grep -rn "createSign" dist/ || true', { cwd: ROOT_DIR }).toString().trim();
    if (createSignMatch) {
      throw new Error(`SECURITY VIOLATION: createSign found in client dist:\n${createSignMatch}`);
    }
    console.log('  ✔ Check B: grep "createSign" -> 0 matches');
  } catch (e) {
    if (e.message.includes('SECURITY VIOLATION')) throw e;
  }

  // C. Check for /api/authority routes in client dist
  try {
    const authRoutesMatch = execSync('grep -rn "/api/authority" dist/ || true', { cwd: ROOT_DIR }).toString().trim();
    if (authRoutesMatch) {
      throw new Error(`SECURITY VIOLATION: /api/authority endpoint found in client dist:\n${authRoutesMatch}`);
    }
    console.log('  ✔ Check C: grep "/api/authority" -> 0 matches');
  } catch (e) {
    if (e.message.includes('SECURITY VIOLATION')) throw e;
  }

  // D. Check for authority/key filenames
  const distFiles = execSync('find dist -type f \\( -iname "*authority*" -o -iname "*keys.json" -o -iname "*credentials*" -o -iname "*generator*" -o -iname "*.pem" -o -iname "*.key" \\) || true', { cwd: ROOT_DIR }).toString().trim();
  if (distFiles) {
    throw new Error(`SECURITY VIOLATION: Authority files found in client dist:\n${distFiles}`);
  }
  console.log('  ✔ Check D: find dist (authority/keys/generator) -> 0 matches');
}

runSecurityAudit();

// Clean unpacked cache directories before building
try {
  fs.rmSync(path.join(ROOT_DIR, 'release-installers', 'client-unpacked'), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT_DIR, 'release-installers', 'keygenerator-unpacked'), { recursive: true, force: true });
} catch (e) {}

// 6. Step 4: Build Client Installer using real electron-builder NSIS
console.log('\n[4/6] Compiling Standalone Client Windows NSIS Installer (LedgerAI-PH-Client-Setup.exe)...');
execSync('npx electron-builder --config electron-builder.client.json --win', { stdio: 'inherit', cwd: ROOT_DIR });

// Clean win-unpacked cache between builds so electron-builder doesn't conflict on executable naming
try {
  fs.rmSync(path.join(ROOT_DIR, 'release-installers', 'win-unpacked'), { recursive: true, force: true });
} catch (e) {}

// 7. Step 5: Build Key Generator Installer using real electron-builder NSIS
console.log('\n[5/6] Compiling Internal Key Generator Windows NSIS Installer (LedgerAI-PH-KeyGenerator-Setup.exe)...');
execSync('npx electron-builder --config electron-builder.keygenerator.json --win', { stdio: 'inherit', cwd: ROOT_DIR });

console.log('========================================================================');
console.log('✔ BOTH WINDOWS NSIS INSTALLERS SUCCESSFULLY BUILT VIA ELECTRON-BUILDER!');
console.log(`  1. Client Installer:        ${clientSetupExe}`);
console.log(`  2. Key Generator Installer: ${keyGenSetupExe}`);
console.log('========================================================================');
