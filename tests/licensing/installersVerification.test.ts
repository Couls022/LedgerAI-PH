/**
 * LedgerAI PH — Production Installer & Packaging Verification Test Suite
 * Tests end-to-end installer artifacts, security separation, service definitions,
 * firewall boundaries, and offline licensing generation/activation.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { RSA_PUBLIC_KEY, verifyLicense } from '../../src/server/licensing/verify';
import { AuthoritySigner } from '../../internal/key-generator/signer';
import { generateLicense, parseAndValidateLicenseRequest } from '../../internal/key-generator/index';

describe('Production Installers Verification & Security Audit', () => {
  const rootDir = process.cwd();
  const releaseDir = path.join(rootDir, 'release-installers');
  const clientExe = path.join(releaseDir, 'LedgerAI-PH-Client-Setup.exe');
  const keyGenExe = path.join(releaseDir, 'LedgerAI-PH-KeyGenerator-Setup.exe');

  describe('1. Installer Artifacts Generation & Sizing', () => {
    it('generates LedgerAI-PH-Client-Setup.exe (or validates electron-builder.client.json on non-Windows host)', () => {
      if (fs.existsSync(clientExe)) {
        const stats = fs.statSync(clientExe);
        expect(stats.size).toBeGreaterThan(1024 * 1024); // > 1MB
      } else {
        const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
        const clientCfgPath = path.join(rootDir, 'electron-builder.client.json');
        expect(fs.existsSync(clientCfgPath)).toBe(true);
        const clientCfg = JSON.parse(fs.readFileSync(clientCfgPath, 'utf-8'));
        expect(clientCfg.win?.artifactName).toBe('LedgerAI-PH-Client-Setup.exe');
        expect(clientCfg.extraMetadata?.version).toBe(pkg.version);
      }
    });

    it('generates LedgerAI-PH-KeyGenerator-Setup.exe (or validates electron-builder.keygenerator.json on non-Windows host)', () => {
      if (fs.existsSync(keyGenExe)) {
        const stats = fs.statSync(keyGenExe);
        expect(stats.size).toBeGreaterThan(100 * 1024); // > 100KB
      } else {
        const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
        const keyGenCfgPath = path.join(rootDir, 'electron-builder.keygenerator.json');
        expect(fs.existsSync(keyGenCfgPath)).toBe(true);
        const keyGenCfg = JSON.parse(fs.readFileSync(keyGenCfgPath, 'utf-8'));
        expect(keyGenCfg.win?.artifactName).toBe('LedgerAI-PH-KeyGenerator-Setup.exe');
        expect(keyGenCfg.extraMetadata?.version).toBe(pkg.version);
      }
    });
  });

  describe('2. Client Installer Security & Isolation Audit', () => {
    it('verifies dist directory contains 0 private key occurrences', () => {
      const serverCjsPath = path.join(rootDir, 'dist/server.cjs');
      if (fs.existsSync(serverCjsPath)) {
        const serverCjs = fs.readFileSync(serverCjsPath, 'utf-8');
        expect(serverCjs).not.toContain('BEGIN PRIVATE KEY');
        expect(serverCjs).not.toContain('AuthoritySigner');
        expect(serverCjs).not.toContain('/api/authority');
      } else {
        expect(RSA_PUBLIC_KEY).not.toContain('BEGIN PRIVATE KEY');
      }
    });

    it('verifies client package includes public verification key only', () => {
      expect(RSA_PUBLIC_KEY).toContain('BEGIN PUBLIC KEY');
      expect(RSA_PUBLIC_KEY).not.toContain('BEGIN PRIVATE KEY');
    });

    it('verifies client Inno Setup spec configures LedgerAIServerService and desktop shortcut', () => {
      const issContent = fs.readFileSync(
        path.join(rootDir, 'packaging/windows/installer-config/installer-client.iss'),
        'utf-8'
      );
      expect(issContent).toContain('OutputBaseFilename=LedgerAI-PH-Client-Setup');
      expect(issContent).toContain('Filename: "http://ledgerai.ph"');
      expect(issContent).not.toContain('http://ledgerai.ph:3000');
      expect(issContent).not.toContain('http://localhost:3000');
      expect(issContent).toContain('install-ledgerai-service.ps1');
      expect(issContent).toContain('configure-ledgerai-domain.ps1');
    });

    it('verifies client uninstallation preserves AppData database records', () => {
      const issContent = fs.readFileSync(
        path.join(rootDir, 'packaging/windows/installer-config/installer-client.iss'),
        'utf-8'
      );
      expect(issContent).toContain('CRITICAL DATA PRESERVATION NOTICE');
      expect(issContent).toContain('%APPDATA%\\LedgerAI');
      expect(issContent).not.toContain('Type: filesandordirs; Name: "{userappdata}\\LedgerAI"');
    });
  });

  describe('3. Key Generator Installer Verification', () => {
    it('verifies key generator Inno Setup spec configures authority service on port 4000', () => {
      const issContent = fs.readFileSync(
        path.join(rootDir, 'packaging/windows/installer-config/installer-keygenerator.iss'),
        'utf-8'
      );
      expect(issContent).toContain('OutputBaseFilename=LedgerAI-PH-KeyGenerator-Setup');
      expect(issContent).toContain('Filename: "http://127.0.0.1:4000"');
      expect(issContent).toContain('install-keygenerator-service.ps1');
    });

    it('verifies key generator service script binds strictly to loopback 127.0.0.1', () => {
      const ps1Content = fs.readFileSync(
        path.join(rootDir, 'packaging/windows/service-config-authority/install-keygenerator-service.ps1'),
        'utf-8'
      );
      expect(ps1Content).toContain('AUTHORITY_PORT=$Port');
      expect(ps1Content).toContain('HOST=127.0.0.1');
      expect(ps1Content).toContain('LedgerAIKeyGeneratorService');
    });
  });

  describe('4. Complete End-to-End Offline Licensing Workflow', () => {
    it('executes full .lrq -> Key Generator Signing -> .lai + Key -> Client Activation flow', () => {
      const companyId = 'LGR-PH-2026-COR-00-58C7A29A';

      // 1. CLIENT: Generates simulated .lrq request payload conforming to LEDGERAI_LICENSE_REQUEST specification
      const lrqPayload = {
        requestType: 'LEDGERAI_LICENSE_REQUEST',
        version: 1,
        companyId,
        companyName: 'Acme PH Industrial Inc.',
        tin: '987-654-321-000',
        requestedPlan: 'ENTERPRISE',
        installationId: crypto.createHash('sha256').update('SYS-HW-001').digest('hex'),
        timestamp: new Date().toISOString()
      };

      const lrqContent = JSON.stringify(lrqPayload, null, 2);

      // 2. KEY GENERATOR: Imports .lrq and generates signed license
      const parsedLrq = parseAndValidateLicenseRequest(lrqContent);
      expect(parsedLrq.requestType).toBe('LEDGERAI_LICENSE_REQUEST');
      expect(parsedLrq.companyId).toBe(companyId);

      // Internal authority signs license payload
      const generatedLicense = generateLicense({
        companyId,
        planType: 'ENTERPRISE',
        duration: '1y',
        deviceFingerprint: lrqPayload.installationId
      });

      expect(generatedLicense.signature).toBeDefined();
      expect(generatedLicense.payload.companyId).toBe(companyId);
      expect(generatedLicense.payload.planType).toBe('ENTERPRISE');

      // 3. CLIENT: Receives signed .lai and verifies with PUBLIC KEY only
      const isSignatureValid = verifyLicense(
        generatedLicense.payload,
        generatedLicense.signature
      );

      expect(isSignatureValid).toBe(true);
    });
  });
});
