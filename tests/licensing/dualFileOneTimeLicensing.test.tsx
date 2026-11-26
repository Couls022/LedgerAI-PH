import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import request from 'supertest';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { AuthoritySigner } from '../../internal/key-generator/signer';
import { generateLicense } from '../../internal/key-generator/index';
import { LocalLicenseRegistry } from '../../src/server/licensing/localLicenseRegistry';
import { AntiRollbackService } from '../../src/server/services/antiRollbackService';
import { RestoreService } from '../../src/server/services/restoreService';
import { validateActiveLicenseForCompany } from '../../src/server/auth';
import { paths } from '../../src/server/services/paths';
import { AuthContext } from '../../src/client/context/AuthContext';
import LicenseActivation from '../../src/client/components/licensing/LicenseActivation';
import LicensingBanner from '../../src/client/components/licensing/LicensingBanner';

// React 19 testing flag for act()
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const TEMP_ROOT = path.join(os.tmpdir(), `ledgerai-dual-lic-test-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
const DATA_DIR = path.join(TEMP_ROOT, 'companies');
const CONFIG_DIR = path.join(TEMP_ROOT, 'config');
const BACKUP_DIR = path.join(TEMP_ROOT, 'backups');

describe('LEDGERAI PH — Dual-File, One-Time, Company-Bound Licensing & Browser-First Suite (30 Scenarios)', () => {
  let app: any;
  let companyAId: string;
  let companyBId: string;
  let ownerTokenA: string;
  let ownerTokenB: string;
  let bookkeeperTokenA: string;
  let companyADir: string;
  let companyBDir: string;

  async function seedUserAndLogin(compId: string, email: string, password: string, roleCode: string): Promise<string> {
    const compDb = await CompanyManager.getCompanyDb(compId);
    await dbContext.run(compDb, async () => {
      const existingUser = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
      let userId = existingUser?.id;
      if (!userId) {
        userId = crypto.randomUUID();
        const passwordHash = await bcrypt.hash(password, 4);
        await db.insert(schema.users).values({
          id: userId,
          email,
          passwordHash,
          displayName: email.split('@')[0],
          status: 'ACTIVE',
        });
      }
      const roleRec = await db.select().from(schema.roles).where(eq(schema.roles.code, roleCode)).get();
      const existingMem = await db.select().from(schema.companyUsers).where(eq(schema.companyUsers.userId, userId)).get();
      if (!existingMem) {
        const memId = crypto.randomUUID();
        await db.insert(schema.companyUsers).values({
          id: memId,
          companyId: compId,
          userId,
          roleId: roleRec?.id || null,
          legacyRole: roleCode,
          status: 'ACTIVE',
        });
        if (roleRec) {
          await db.insert(schema.companyUserRoles).values({
            id: crypto.randomUUID(),
            companyUserId: memId,
            roleId: roleRec.id,
            roleCode,
            isPrimary: true,
            assignmentStatus: 'ACTIVE',
          }).onConflictDoNothing();
        }
      }
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ companyId: compId, email, password });
    expect(loginRes.status).toBe(200);
    return loginRes.body.token;
  }

  /**
   * Mounts the real React LicenseActivation component in JSDOM and bridges fetch()
   * straight to the real Express server via supertest.
   */
  async function mountBrowserActivationScreen(options: {
    companyId: string;
    legalName: string;
    token?: string;
    role?: string;
    permissions?: string[];
  }) {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://localhost:3000/settings',
    });

    const prevWindow = (globalThis as any).window;
    const prevDocument = (globalThis as any).document;
    const prevFetch = (globalThis as any).fetch;
    const prevFileReader = (globalThis as any).FileReader;
    const prevEvent = (globalThis as any).Event;

    (globalThis as any).window = dom.window;
    (globalThis as any).document = dom.window.document;
    (globalThis as any).Event = dom.window.Event;

    // Polyfill FileReader in Node for JSDOM <input type="file">
    (globalThis as any).FileReader = class MockFileReader {
      public result: string | null = null;
      public onload: ((ev: any) => void) | null = null;
      readAsText(file: any) {
        const text = typeof file._rawContent === 'string' ? file._rawContent : '';
        this.result = text;
        if (this.onload) {
          this.onload({ target: { result: text } });
        }
      }
    };

    const fetchImpl = async (url: string, init: any = {}) => {
      const method = (init.method || 'GET').toLowerCase();
      let reqBuilder = (request(app) as any)[method](url);
      if (options.token) {
        reqBuilder = reqBuilder.set('Authorization', `Bearer ${options.token}`);
      }
      if (init.headers) {
        const entries =
          typeof init.headers.entries === 'function'
            ? Array.from(init.headers.entries())
            : Object.entries(init.headers);
        for (const [k, v] of entries as Array<[string, any]>) {
          reqBuilder = reqBuilder.set(k, String(v));
        }
      }
      if (init.body) {
        const parsedBody = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        reqBuilder = reqBuilder.send(parsedBody);
      }
      const res = await reqBuilder;
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-type'
              ? res.headers?.['content-type'] || 'application/json'
              : res.headers?.[name.toLowerCase()] || null,
        },
        json: async () => res.body,
        text: async () => (typeof res.text === 'string' ? res.text : JSON.stringify(res.body)),
      };
    };
    (globalThis as any).fetch = fetchImpl;
    (dom.window as any).fetch = fetchImpl;

    const container = dom.window.document.getElementById('root')!;
    const root = createRoot(container);

    const authMockValue: any = {
      user: { id: 'usr-admin', email: 'owner@test.ph', displayName: 'Company Owner', role: options.role || 'COMPANY_OWNER' },
      activeCompany: {
        id: options.companyId,
        legalName: options.legalName,
        tin: '111-222-333-000',
        role: options.role || 'COMPANY_OWNER',
      },
      permissions: options.permissions || ['settings:manage'],
      hasPermission: (reqs: string[]) => reqs.some((r) => (options.permissions || ['settings:manage']).includes(r)),
      isAuthenticated: true,
      loading: false,
    };

    await act(async () => {
      root.render(
        React.createElement(
          AuthContext.Provider,
          { value: authMockValue },
          React.createElement(LicenseActivation, {})
        )
      );
    });

    const getKeyInput = () => dom.window.document.getElementById('license-key-file-input') as HTMLInputElement;
    const getLicInput = () => dom.window.document.getElementById('key-license-file-input') as HTMLInputElement;
    const getActivateButton = () => {
      const buttons = Array.from(dom.window.document.querySelectorAll('button')) as HTMLButtonElement[];
      return buttons.find((b) => (b.textContent || '').includes('Activate License') || (b.textContent || '').includes('Validating license pair'))!;
    };
    const getStateText = () =>
      dom.window.document.querySelector('[data-testid="activation-ui-state"]')?.textContent?.trim() || '';
    const getStatusBannerText = () =>
      dom.window.document.querySelector('[role="status"]')?.textContent?.trim() || '';

    const selectFile = async (inputEl: HTMLInputElement, name: string, content: string) => {
      const fakeFile = {
        name,
        size: Buffer.byteLength(content, 'utf8'),
        _rawContent: content,
      };
      Object.defineProperty(inputEl, 'files', {
        configurable: true,
        value: [fakeFile],
      });
      await act(async () => {
        inputEl.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      });
    };

    const clickActivate = async () => {
      const btn = getActivateButton();
      await act(async () => {
        if (btn.form) {
          btn.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        } else {
          btn.click();
        }
      });
      for (let i = 0; i < 40; i++) {
        const current = getStateText();
        if (current !== 'Both files selected' && current !== 'Validating license pair') {
          break;
        }
        await act(async () => {
          await new Promise((r) => setTimeout(r, 25));
        });
      }
    };

    const unmount = async () => {
      await act(async () => {
        root.unmount();
      });
      dom.window.close();
      (globalThis as any).window = prevWindow;
      (globalThis as any).document = prevDocument;
      (globalThis as any).fetch = prevFetch;
      (globalThis as any).FileReader = prevFileReader;
      (globalThis as any).Event = prevEvent;
    };

    return {
      dom,
      getKeyInput,
      getLicInput,
      getActivateButton,
      getStateText,
      getStatusBannerText,
      selectKeyFile: (name: string, content: string) => selectFile(getKeyInput(), name, content),
      selectLicenseFile: (name: string, content: string) => selectFile(getLicInput(), name, content),
      clickActivate,
      unmount,
    };
  }

  async function resetCompanyToTrial(compId: string) {
    LocalLicenseRegistry.resetForTesting([compId]);
    const compDb = await CompanyManager.getCompanyDb(compId);
    await dbContext.run(compDb, async () => {
      await db.delete(schema.licenseRedemptionRecords).where(eq(schema.licenseRedemptionRecords.companyId, compId));
      await db.delete(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, compId));
      const startDate = new Date().toISOString().slice(0, 10);
      const expDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await db.insert(schema.companyLicenses).values({
        id: crypto.randomUUID(),
        companyId: compId,
        licenseKey: `LEDGERAI-TRIAL-${compId.slice(0, 8)}`,
        planType: 'TRIAL',
        status: 'ACTIVE',
        trialStartDate: startDate,
        expirationDate: expDate,
        signedFileContent: JSON.stringify({ companyId: compId, plan: 'TRIAL' }),
        isLifetime: false,
      });
    });
    const tsFile = paths.getTimeStateFilePath(compId);
    if (fs.existsSync(tsFile)) fs.unlinkSync(tsFile);
    const m = await CompanyManager.getCompanyManifest(compId);
    if (m?.location) {
      const locTs = path.join(m.location, '.time_state.bin');
      if (fs.existsSync(locTs)) fs.unlinkSync(locTs);
    }
  }

  beforeAll(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.mkdir(CONFIG_DIR, { recursive: true });
    await fsp.mkdir(BACKUP_DIR, { recursive: true });

    process.env.LEDGERAI_DATA_DIR = DATA_DIR;
    process.env.LEDGERAI_CONFIG_DIR = CONFIG_DIR;
    await CompanyManager.closeAllConnections();
    await CompanyManager.init();
    LocalLicenseRegistry.resetForTesting();

    app = createApp();

    // Create Company A
    const compADirPath = path.join(DATA_DIR, 'company_alpha');
    const resA = await request(app)
      .post('/api/companies/create-profile')
      .send({
        company: {
          legalName: 'Manila Alpha Trading Corp',
          tin: '111-111-111-000',
          taxpayerClassification: 'CORPORATION',
          vatStatus: 'VAT',
        },
        admin: {
          email: 'owner.a@alpha.ph',
          password: 'Password123!',
          displayName: 'Owner A',
        },
        locationPath: compADirPath,
      });
    expect(resA.status).toBe(200);
    companyAId = resA.body.companyId;
    companyADir = (await CompanyManager.getCompanyManifest(companyAId))!.location!;

    // Create Company B
    const compBDirPath = path.join(DATA_DIR, 'company_beta');
    const resB = await request(app)
      .post('/api/companies/create-profile')
      .send({
        company: {
          legalName: 'Cebu Beta Logistics Inc',
          tin: '222-222-222-000',
          taxpayerClassification: 'CORPORATION',
          vatStatus: 'VAT',
        },
        admin: {
          email: 'owner.b@beta.ph',
          password: 'Password123!',
          displayName: 'Owner B',
        },
        locationPath: compBDirPath,
      });
    expect(resB.status).toBe(200);
    companyBId = resB.body.companyId;
    companyBDir = (await CompanyManager.getCompanyManifest(companyBId))!.location!;

    // Verify Browser-First rule: NO mandatory .exe launcher generated per company
    const dirAFiles = fs.readdirSync(companyADir);
    expect(dirAFiles.some((f) => f.toLowerCase().endsWith('.exe'))).toBe(false);

    ownerTokenA = await seedUserAndLogin(companyAId, 'owner.a@alpha.ph', 'Password123!', 'COMPANY_OWNER');
    ownerTokenB = await seedUserAndLogin(companyBId, 'owner.b@beta.ph', 'Password123!', 'COMPANY_OWNER');
    bookkeeperTokenA = await seedUserAndLogin(companyAId, 'bookkeeper.a@alpha.ph', 'Password123!', 'BOOKKEEPER');
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    LocalLicenseRegistry.resetForTesting();
    await fsp.rm(TEMP_ROOT, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    AuthoritySigner.clearCacheForTesting();
    await resetCompanyToTrial(companyAId);
    await resetCompanyToTrial(companyBId);
  });

  it('1. Both files missing: UI disables Activate License, shows "Both files missing", server rejects 400', async () => {
    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });
    expect(ui.getStateText()).toBe('Both files missing');
    expect(ui.getActivateButton().disabled).toBe(true);

    const apiRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({});
    expect(apiRes.status).toBe(400);
    expect(apiRes.body.error).toBe('BOTH_FILES_REQUIRED');
    await ui.unmount();
  });

  it('2. License Key File missing: only Key License File provided keeps button disabled and server rejects 400', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });

    await ui.selectLicenseFile('company.lai', gen.keyLicenseFileJson);
    expect(ui.getStateText()).toBe('Key License File selected');
    expect(ui.getActivateButton().disabled).toBe(true);

    const apiRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ keyLicenseFile: gen.keyLicenseFileJson });
    expect(apiRes.status).toBe(400);
    expect(apiRes.body.error).toBe('LICENSE_KEY_FILE_REQUIRED');
    await ui.unmount();
  });

  it('3. Key License File missing: only License Key File provided keeps button disabled and server rejects 400', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });

    await ui.selectKeyFile('company.lkey', gen.licenseKeyFileJson);
    expect(ui.getStateText()).toBe('License Key File selected');
    expect(ui.getActivateButton().disabled).toBe(true);

    const apiRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson });
    expect(apiRes.status).toBe(400);
    expect(apiRes.body.error).toBe('KEY_LICENSE_FILE_REQUIRED');
    await ui.unmount();
  });

  it('4. Both files valid and matching: UI shows Activation successful and server persists REDEEMED activation receipt', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'ENTERPRISE', duration: 'lifetime' });
    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });

    await ui.selectKeyFile('alpha.lkey', gen.licenseKeyFileJson);
    await ui.selectLicenseFile('alpha.lai', gen.keyLicenseFileJson);
    expect(ui.getStateText()).toBe('Both files selected');
    expect(ui.getActivateButton().disabled).toBe(false);

    await ui.clickActivate();
    expect(ui.getStateText()).toBe('Activation successful');
    expect(ui.getStatusBannerText()).toContain('Activation successful');

    const statusRes = await request(app)
      .get('/api/licensing/status')
      .set('Authorization', `Bearer ${ownerTokenA}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.planType).toBe('ENTERPRISE');
    expect(statusRes.body.status).toBe('ACTIVE');
    expect(statusRes.body.licensePairId).toBe(gen.licensePairId);
    expect(statusRes.body.activationRecordId).toMatch(/^ACT-/);

    const regCheck = LocalLicenseRegistry.getRecordByPairId(gen.licensePairId);
    expect(regCheck.valid).toBe(true);
    expect(regCheck.record?.companyId).toBe(companyAId);
    expect(regCheck.record?.status).toBe('ACTIVE');
    await ui.unmount();
  });

  it('5. Both files valid but mismatched: mixing Pair 1 .lkey with Pair 2 .lai is rejected in UI and server', async () => {
    const pair1 = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    const pair2 = generateLicense({ companyId: companyAId, planType: 'ENTERPRISE', duration: 'lifetime' });

    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });
    await ui.selectKeyFile('pair1.lkey', pair1.licenseKeyFileJson);
    await ui.selectLicenseFile('pair2.lai', pair2.keyLicenseFileJson);
    await ui.clickActivate();

    expect(ui.getStateText()).toBe('License pair mismatch');

    const apiRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: pair1.licenseKeyFileJson, keyLicenseFile: pair2.keyLicenseFileJson });
    expect(apiRes.status).toBe(403);
    expect(apiRes.body.error).toBe('LICENSE_PAIR_MISMATCH');
    await ui.unmount();
  });

  it('6. Invalid License Key File: corrupt JSON / malformed structure rejected', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });

    await ui.selectKeyFile('broken.lkey', '{ not-valid-json');
    await ui.selectLicenseFile('valid.lai', gen.keyLicenseFileJson);
    await ui.clickActivate();

    expect(ui.getStateText()).toBe('Activation failed');

    const apiRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: JSON.stringify({ payload: { foo: 'bar' }, signature: 'x' }), keyLicenseFile: gen.keyLicenseFileJson });
    expect(apiRes.status).toBe(403);
    expect(apiRes.body.error).toBe('INVALID_LICENSE_KEY_FILE');
    await ui.unmount();
  });

  it('7. Invalid Key License File: corrupt JSON / wrong artifact structure rejected', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });

    await ui.selectKeyFile('valid.lkey', gen.licenseKeyFileJson);
    await ui.selectLicenseFile('broken.lai', '{"bad": true}');
    await ui.clickActivate();

    expect(ui.getStateText()).toBe('Activation failed');

    const apiRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: 'CORRUPT_CONTENT' });
    expect(apiRes.status).toBe(403);
    expect(apiRes.body.error).toBe('INVALID_KEY_LICENSE_FILE');
    await ui.unmount();
  });

  it('8. Invalid digital signature: forged signature fails UI & server verification', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    const parsedLic = JSON.parse(gen.keyLicenseFileJson);
    parsedLic.signature = Buffer.from('forged-rsa-signature-bytes').toString('base64');

    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });
    await ui.selectKeyFile('valid.lkey', gen.licenseKeyFileJson);
    await ui.selectLicenseFile('forged.lai', JSON.stringify(parsedLic));
    await ui.clickActivate();

    expect(ui.getStateText()).toBe('Invalid signature');

    const apiRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: JSON.stringify(parsedLic) });
    expect(apiRes.status).toBe(403);
    expect(apiRes.body.error).toBe('INVALID_SIGNATURE');
    await ui.unmount();
  });

  it('9. Modified license contents: elevating planType in .lai invalidates signature and is blocked', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    const parsedLic = JSON.parse(gen.keyLicenseFileJson);
    parsedLic.payload.planType = 'ENTERPRISE';
    parsedLic.payload.seatCount = 'UNLIMITED';

    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });
    await ui.selectKeyFile('alpha.lkey', gen.licenseKeyFileJson);
    await ui.selectLicenseFile('tampered.lai', JSON.stringify(parsedLic));
    await ui.clickActivate();

    expect(ui.getStateText()).toBe('Invalid signature');

    const apiRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: JSON.stringify(parsedLic) });
    expect(apiRes.status).toBe(403);
    expect(apiRes.body.error).toBe('INVALID_SIGNATURE');
    await ui.unmount();
  });

  it('10. Incorrect Company ID: Pair bound to Company B fails on Company A', async () => {
    const genB = generateLicense({ companyId: companyBId, planType: 'PRO', duration: 'yearly' });
    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });

    await ui.selectKeyFile('beta.lkey', genB.licenseKeyFileJson);
    await ui.selectLicenseFile('beta.lai', genB.keyLicenseFileJson);
    await ui.clickActivate();

    expect(ui.getStateText()).toBe('Company identity mismatch');

    const apiRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: genB.licenseKeyFileJson, keyLicenseFile: genB.keyLicenseFileJson });
    expect(apiRes.status).toBe(403);
    expect(apiRes.body.error).toBe('COMPANY_IDENTITY_MISMATCH');
    await ui.unmount();
  });

  it('11. Expired license: expired term pair is rejected with LICENSE_EXPIRED', async () => {
    const expiredPair = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'custom', customDays: -30 });
    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });

    await ui.selectKeyFile('expired.lkey', expiredPair.licenseKeyFileJson);
    await ui.selectLicenseFile('expired.lai', expiredPair.keyLicenseFileJson);
    await ui.clickActivate();

    expect(ui.getStateText()).toBe('License expired');

    const apiRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: expiredPair.licenseKeyFileJson, keyLicenseFile: expiredPair.keyLicenseFileJson });
    expect(apiRes.status).toBe(403);
    expect(apiRes.body.error).toBe('LICENSE_EXPIRED');
    await ui.unmount();
  });

  it('12. Revoked license: signed revoked pair is rejected with LICENSE_REVOKED', async () => {
    const revokedPair = generateLicense({ companyId: companyAId, planType: 'ENTERPRISE', duration: 'lifetime', status: 'REVOKED' });
    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });

    await ui.selectKeyFile('revoked.lkey', revokedPair.licenseKeyFileJson);
    await ui.selectLicenseFile('revoked.lai', revokedPair.keyLicenseFileJson);
    await ui.clickActivate();

    expect(ui.getStateText()).toBe('License revoked');

    const apiRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: revokedPair.licenseKeyFileJson, keyLicenseFile: revokedPair.keyLicenseFileJson });
    expect(apiRes.status).toBe(403);
    expect(apiRes.body.error).toBe('LICENSE_REVOKED');
    await ui.unmount();
  });

  it('13. Suspended license: signed suspended pair is rejected with LICENSE_SUSPENDED', async () => {
    const suspendedPair = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly', status: 'SUSPENDED' });
    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });

    await ui.selectKeyFile('suspended.lkey', suspendedPair.licenseKeyFileJson);
    await ui.selectLicenseFile('suspended.lai', suspendedPair.keyLicenseFileJson);
    await ui.clickActivate();

    expect(ui.getStateText()).toBe('Activation failed');
    expect(ui.getStatusBannerText()).toContain('suspended');

    const apiRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: suspendedPair.licenseKeyFileJson, keyLicenseFile: suspendedPair.keyLicenseFileJson });
    expect(apiRes.status).toBe(403);
    expect(apiRes.body.error).toBe('LICENSE_SUSPENDED');
    await ui.unmount();
  });

  it('14. Already redeemed license pair: consumed pair cannot be redeemed again onto reset DB', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    const firstRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: gen.keyLicenseFileJson });
    expect(firstRes.status).toBe(200);

    // Clear ONLY DB activation row (simulating fresh DB/rollback while registry retains redemption)
    const compDb = await CompanyManager.getCompanyDb(companyAId);
    await dbContext.run(compDb, async () => {
      await db.delete(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, companyAId));
    });

    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });
    await ui.selectKeyFile('alpha.lkey', gen.licenseKeyFileJson);
    await ui.selectLicenseFile('alpha.lai', gen.keyLicenseFileJson);
    await ui.clickActivate();

    expect(ui.getStateText()).toBe('License already redeemed');

    const replayRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: gen.keyLicenseFileJson });
    expect(replayRes.status).toBe(403);
    expect(replayRes.body.error).toBe('LICENSE_ALREADY_REDEEMED');
    await ui.unmount();
  });

  it('15. Reuse of a pair for another company: rejected by both Company ID binding and redeemed registry guard', async () => {
    const genA = generateLicense({ companyId: companyAId, planType: 'ENTERPRISE', duration: 'lifetime' });
    const res1 = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: genA.licenseKeyFileJson, keyLicenseFile: genA.keyLicenseFileJson });
    expect(res1.status).toBe(200);

    const uiB = await mountBrowserActivationScreen({ companyId: companyBId, legalName: 'Cebu Beta Logistics Inc', token: ownerTokenB });
    await uiB.selectKeyFile('stolen_a.lkey', genA.licenseKeyFileJson);
    await uiB.selectLicenseFile('stolen_a.lai', genA.keyLicenseFileJson);
    await uiB.clickActivate();

    expect(uiB.getStateText()).toBe('Company identity mismatch');

    const res2 = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .send({ licenseKeyFile: genA.licenseKeyFileJson, keyLicenseFile: genA.keyLicenseFileJson });
    expect(res2.status).toBe(403);
    expect(['COMPANY_IDENTITY_MISMATCH', 'LICENSE_ALREADY_REDEEMED']).toContain(res2.body.error);
    await uiB.unmount();
  });

  it('16. Pair replay: restoring outdated pre-activation DB snapshot cannot replay already-redeemed pair', async () => {
    // Take pre-activation backup
    const preBackup = await RestoreService.exportBackup(companyAId);
    const gen = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });

    const actRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: gen.keyLicenseFileJson });
    expect(actRes.status).toBe(200);

    // Restore pre-activation state (still in TRIAL, no activation receipt)
    await RestoreService.restoreDatabase(preBackup, companyAId, 'REPLACE', null, companyADir);
    ownerTokenA = await seedUserAndLogin(companyAId, 'owner.a@alpha.ph', 'Password123!', 'COMPANY_OWNER');

    // Attempt replay
    const replayRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: gen.keyLicenseFileJson });
    expect(replayRes.status).toBe(403);
    expect(replayRes.body.error).toBe('LICENSE_ALREADY_REDEEMED');
  });

  it('17. Duplicate activation request: idempotent retry for same intact activated company creates zero duplicate records', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'ENTERPRISE', duration: 'lifetime' });
    const first = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: gen.keyLicenseFileJson });
    expect(first.status).toBe(200);
    expect(first.body.idempotent).toBe(false);

    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });
    await ui.selectKeyFile('alpha.lkey', gen.licenseKeyFileJson);
    await ui.selectLicenseFile('alpha.lai', gen.keyLicenseFileJson);
    await ui.clickActivate();
    expect(ui.getStateText()).toBe('Activation successful');

    const compDb = await CompanyManager.getCompanyDb(companyAId);
    await dbContext.run(compDb, async () => {
      const redemptions = await db.select().from(schema.licenseRedemptionRecords).where(eq(schema.licenseRedemptionRecords.companyId, companyAId)).all();
      expect(redemptions.length).toBe(1);
    });
    await ui.unmount();
  });

  it('18. Repeated opening after successful activation remembers active license without file reinsertion', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly', seatCount: 5 });
    const actRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: gen.keyLicenseFileJson });
    expect(actRes.status).toBe(200);

    // Close & Reopen company folder
    await CompanyManager.closeCompanyDb(companyAId);
    const openRes = await request(app)
      .post('/api/companies/open-database')
      .send({ filePath: companyADir });
    expect(openRes.status).toBe(200);

    const statusRes = await request(app)
      .get('/api/licensing/status')
      .set('Authorization', `Bearer ${ownerTokenA}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('ACTIVE');
    expect(statusRes.body.planType).toBe('PRO');
    expect(statusRes.body.seatCount).toBe(5);
  });

  it('19. Browser restart after successful activation retrieves persistent active license from server without localStorage', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'ENTERPRISE', duration: 'lifetime' });
    await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: gen.keyLicenseFileJson });

    // Simulate completely fresh browser login (empty localStorage / new session token)
    const freshToken = await seedUserAndLogin(companyAId, 'owner.a@alpha.ph', 'Password123!', 'COMPANY_OWNER');
    const statusRes = await request(app)
      .get('/api/licensing/status')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.planType).toBe('ENTERPRISE');
    expect(statusRes.body.status).toBe('ACTIVE');
    expect(statusRes.body.isLifetime).toBe(true);
  });

  it('20. Local server restart after successful activation preserves active license automatically', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: gen.keyLicenseFileJson });

    // Full server shutdown & re-instantiation
    await CompanyManager.closeAllConnections();
    await CompanyManager.init();
    const newAppInstance = createApp();

    const compDb = await CompanyManager.getCompanyDb(companyAId);
    const loginRes = await request(newAppInstance)
      .post('/api/auth/login')
      .send({ companyId: companyAId, email: 'owner.a@alpha.ph', password: 'Password123!' });
    expect(loginRes.status).toBe(200);

    const statusRes = await request(newAppInstance)
      .get('/api/licensing/status')
      .set('Authorization', `Bearer ${loginRes.body.token}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('ACTIVE');
    expect(statusRes.body.planType).toBe('PRO');
    expect(compDb).toBeDefined();
  });

  it('21. Company switching loads distinct per-company activation state without cross-company bleed', async () => {
    const genA = generateLicense({ companyId: companyAId, planType: 'ENTERPRISE', duration: 'lifetime' });
    await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: genA.licenseKeyFileJson, keyLicenseFile: genA.keyLicenseFileJson });

    const statusA = await request(app).get('/api/licensing/status').set('Authorization', `Bearer ${ownerTokenA}`);
    const statusB = await request(app).get('/api/licensing/status').set('Authorization', `Bearer ${ownerTokenB}`);

    expect(statusA.body.planType).toBe('ENTERPRISE');
    expect(statusA.body.companyId).toBe(companyAId);
    expect(statusB.body.planType).toBe('TRIAL');
    expect(statusB.body.companyId).toBe(companyBId);
  });

  it('22. Company backup and restore preserves signed activation record on same company and blocks license acquisition on clone', async () => {
    const genA = generateLicense({ companyId: companyAId, planType: 'ENTERPRISE', duration: 'lifetime' });
    const actRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: genA.licenseKeyFileJson, keyLicenseFile: genA.keyLicenseFileJson });
    expect(actRes.status).toBe(200);

    const backupRes = await RestoreService.exportBackup(companyAId);

    // Restore SAME company (should keep ACTIVE ENTERPRISE license without re-insertion)
    await RestoreService.restoreDatabase(backupRes, companyAId, 'REPLACE', null, companyADir);
    ownerTokenA = await seedUserAndLogin(companyAId, 'owner.a@alpha.ph', 'Password123!', 'COMPANY_OWNER');
    const restoredStatus = await request(app).get('/api/licensing/status').set('Authorization', `Bearer ${ownerTokenA}`);
    expect(restoredStatus.status).toBe(200);
    expect(restoredStatus.body.status).toBe('ACTIVE');
    expect(restoredStatus.body.planType).toBe('ENTERPRISE');
    expect(restoredStatus.body.licensePairId).toBe(genA.licensePairId);

    // 1. Cloning Company A's backup into a new company ID never inherits Company A's ENTERPRISE license or pair ID
    const clonedId = await RestoreService.restoreDatabase(backupRes, '', 'NEW', null, undefined, { cloneAsNew: true });
    const clonedDb = await CompanyManager.getCompanyDb(clonedId);
    await dbContext.run(clonedDb, async () => {
      const clonedLic = await db.select().from(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, clonedId)).get();
      expect(clonedLic?.planType).not.toBe('ENTERPRISE');
      expect((clonedLic as any)?.licensePairId || null).toBeNull();
    });
    await CompanyManager.closeCompanyDb(clonedId).catch(() => {});

    // 2. Attempting to substitute Company A's signed license record into Company B fails closed
    const compBDb = await CompanyManager.getCompanyDb(companyBId);
    await dbContext.run(compBDb, async () => {
      await db.update(schema.companyLicenses).set({
        planType: 'ENTERPRISE',
        signedFileContent: genA.keyLicenseFileJson,
        keyFileContent: genA.licenseKeyFileJson,
        licensePairId: genA.licensePairId,
        keyFileId: genA.keyFileId,
        activationRecordId: actRes.body.activationRecordId,
      }).where(eq(schema.companyLicenses.companyId, companyBId));
    });
    const cloneLicCheck = await validateActiveLicenseForCompany(companyBId);
    expect(cloneLicCheck.valid).toBe(false);
    expect(['LICENSE_INVALID', 'TAMPERED']).toContain(cloneLicCheck.code);
  });

  it('23. Missing activation metadata in DB fails closed as RECOVERY_REQUIRED', async () => {
    const genA = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: genA.licenseKeyFileJson, keyLicenseFile: genA.keyLicenseFileJson });

    const compDb = await CompanyManager.getCompanyDb(companyAId);
    await dbContext.run(compDb, async () => {
      await db.update(schema.companyLicenses).set({
        activationReceipt: null,
        keyFileContent: null,
      }).where(eq(schema.companyLicenses.companyId, companyAId));
    });

    const licCheck = await validateActiveLicenseForCompany(companyAId);
    expect(licCheck.valid).toBe(false);
    expect(licCheck.detailCode).toBe('MISSING_ACTIVATION_METADATA');

    const statusRes = await request(app).get('/api/licensing/status').set('Authorization', `Bearer ${ownerTokenA}`);
    expect(statusRes.body.status).toBe('RECOVERY_REQUIRED');
    expect(statusRes.body.recoveryRequired).toBe(true);
  });

  it('24. Corrupted activation metadata in DB fails closed as TAMPERED / RECOVERY_REQUIRED', async () => {
    const genA = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: genA.licenseKeyFileJson, keyLicenseFile: genA.keyLicenseFileJson });

    const compDb = await CompanyManager.getCompanyDb(companyAId);
    await dbContext.run(compDb, async () => {
      await db.update(schema.companyLicenses).set({
        activationReceipt: '{"receiptData":{"companyId":"' + companyAId + '"},"hmacSignature":"bad_tampered_hex"}',
      }).where(eq(schema.companyLicenses.companyId, companyAId));
    });

    const licCheck = await validateActiveLicenseForCompany(companyAId);
    expect(licCheck.valid).toBe(false);
    expect(licCheck.detailCode).toBe('CORRUPTED_ACTIVATION_METADATA');

    const statusRes = await request(app).get('/api/licensing/status').set('Authorization', `Bearer ${ownerTokenA}`);
    expect(statusRes.body.status).toBe('RECOVERY_REQUIRED');
  });

  it('25. Registry mismatch (tampered local registry or conflicting record) fails closed as REGISTRY_MISMATCH', async () => {
    const genA = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: genA.licenseKeyFileJson, keyLicenseFile: genA.keyLicenseFileJson });

    // Tamper trusted-license-registry.json digest
    const regPath = path.join(CONFIG_DIR, 'trusted-license-registry.json');
    const regJson = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    regJson.registryDigest = '0000000000tampered';
    fs.writeFileSync(regPath, JSON.stringify(regJson), 'utf8');

    const licCheck = await validateActiveLicenseForCompany(companyAId);
    expect(licCheck.valid).toBe(false);
    expect(licCheck.detailCode).toBe('REGISTRY_MISMATCH');

    const statusRes = await request(app).get('/api/licensing/status').set('Authorization', `Bearer ${ownerTokenA}`);
    expect(statusRes.body.status).toBe('RECOVERY_REQUIRED');
    expect(statusRes.body.verificationCode).toBe('REGISTRY_MISMATCH');
  });

  it('26. Anti-rollback behavior locks company into TAMPERED state and blocks new activations', async () => {
    // Advance monotonic timestamp into the future (+10 days)
    const futureMs = Date.now() + 10 * 24 * 60 * 60 * 1000;
    await AntiRollbackService.recordTimestamp(companyAId, futureMs);

    const check = await validateActiveLicenseForCompany(companyAId);
    expect(check.valid).toBe(false);
    expect(check.code).toBe('TAMPERED');

    const genA = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    const actRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: genA.licenseKeyFileJson, keyLicenseFile: genA.keyLicenseFileJson });
    expect(actRes.status).toBe(403);
    expect(actRes.body.error).toBe('TAMPERED');
  });

  it('27. Authorized recovery restores damaged license state with full audit record and blocks recovery without Authority ref', async () => {
    const pair1 = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    const res1 = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: pair1.licenseKeyFileJson, keyLicenseFile: pair1.keyLicenseFileJson });
    expect(res1.status).toBe(200);

    // Reject unreferenced recovery attempt
    const pairWithoutRef = generateLicense({ companyId: companyAId, planType: 'ENTERPRISE', duration: 'lifetime' });
    const badRecRes = await request(app)
      .post('/api/licensing/recover')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        licenseKeyFile: pairWithoutRef.licenseKeyFileJson,
        keyLicenseFile: pairWithoutRef.keyLicenseFileJson,
        recoveryReason: 'Missing authority reference check',
      });
    expect(badRecRes.status).toBe(403);
    expect(badRecRes.body.error).toBe('AUTHORIZED_RECOVERY_REFERENCE_REQUIRED');

    // Authorized recovery issued by Authority with explicit recoveryReference linking to pair1.licensePairId
    const recoveryPair = generateLicense({
      companyId: companyAId,
      planType: 'ENTERPRISE',
      duration: 'lifetime',
      recoveryReference: pair1.licensePairId,
      recoveryReason: 'Workstation server migration recovery',
    });

    const goodRecRes = await request(app)
      .post('/api/licensing/recover')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        licenseKeyFile: recoveryPair.licenseKeyFileJson,
        keyLicenseFile: recoveryPair.keyLicenseFileJson,
        recoveryReason: 'Workstation server migration recovery',
      });
    expect(goodRecRes.status).toBe(200);
    expect(goodRecRes.body.licensePairId).toBe(recoveryPair.licensePairId);

    const statusRes = await request(app).get('/api/licensing/status').set('Authorization', `Bearer ${ownerTokenA}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.planType).toBe('ENTERPRISE');
    expect(statusRes.body.licensePairId).toBe(recoveryPair.licensePairId);
  });

  it('28. Unauthorized license replacement: silently replacing active pair with a different pair is blocked (403)', async () => {
    const pair1 = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });
    const pair2 = generateLicense({ companyId: companyAId, planType: 'ENTERPRISE', duration: 'lifetime' });

    const r1 = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: pair1.licenseKeyFileJson, keyLicenseFile: pair1.keyLicenseFileJson });
    expect(r1.status).toBe(200);

    const r2 = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ licenseKeyFile: pair2.licenseKeyFileJson, keyLicenseFile: pair2.keyLicenseFileJson });
    expect(r2.status).toBe(403);
    expect(r2.body.error).toBe('UNAUTHORIZED_LICENSE_REPLACEMENT');

    // Original license remains untouched
    const statusRes = await request(app).get('/api/licensing/status').set('Authorization', `Bearer ${ownerTokenA}`);
    expect(statusRes.body.licensePairId).toBe(pair1.licensePairId);
    expect(statusRes.body.planType).toBe('PRO');
  });

  it('29. Frontend manipulation attempts: localStorage spoofing and forged body flags cannot bypass server licensing verification', async () => {
    // 1. Forged request body fields ignored by server
    const spoofRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        status: 'ACTIVE',
        planType: 'ENTERPRISE',
        bypass: true,
        activationKey: 'LGR-ENTERPRISE-SPOOFED',
      });
    expect(spoofRes.status).toBe(400);
    expect(spoofRes.body.error).toBe('BOTH_FILES_REQUIRED');

    // 2. Company A still in TRIAL on server; enterprise-entitled route still rejects
    const statusRes = await request(app)
      .get('/api/licensing/status')
      .set('Authorization', `Bearer ${ownerTokenA}`);
    expect(statusRes.body.planType).toBe('TRIAL');

    // 3. UI never stores secrets/authoritative activation state in localStorage
    const ui = await mountBrowserActivationScreen({ companyId: companyAId, legalName: 'Manila Alpha Trading Corp', token: ownerTokenA });
    const lsMock: Record<string, string> = {};
    (ui.dom.window as any).localStorage.setItem('license_status', 'ENTERPRISE_ACTIVE');
    lsMock['license_status'] = 'ENTERPRISE_ACTIVE';

    // UI Banner reads strictly from server /api/licensing/status
    const bannerContainer = ui.dom.window.document.createElement('div');
    ui.dom.window.document.body.appendChild(bannerContainer);
    const bannerRoot = createRoot(bannerContainer);
    await act(async () => {
      bannerRoot.render(
        React.createElement(
          AuthContext.Provider,
          {
            value: {
              user: { id: 'usr-admin', email: 'owner.a@alpha.ph', displayName: 'Owner A', role: 'COMPANY_OWNER' },
              activeCompany: { id: companyAId, legalName: 'Manila Alpha Trading Corp', role: 'COMPANY_OWNER' },
              permissions: ['settings:manage'],
              hasPermission: () => true,
            } as any,
          },
          React.createElement(LicensingBanner, {})
        )
      );
    });
    for (let i = 0; i < 40; i++) {
      if ((bannerContainer.textContent || '').trim().length > 0) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
    }
    expect(bannerContainer.textContent).toContain('15-DAY TRIAL');
    await act(async () => bannerRoot.unmount());
    await ui.unmount();
  });

  it('30. Unauthorized API activation attempts: unauthenticated returns 401 and non-admin lacks settings:manage (403)', async () => {
    const gen = generateLicense({ companyId: companyAId, planType: 'PRO', duration: 'yearly' });

    const unauthRes = await request(app)
      .post('/api/licensing/activate')
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: gen.keyLicenseFileJson });
    expect(unauthRes.status).toBe(401);

    const bookkeeperRes = await request(app)
      .post('/api/licensing/activate')
      .set('Authorization', `Bearer ${bookkeeperTokenA}`)
      .send({ licenseKeyFile: gen.licenseKeyFileJson, keyLicenseFile: gen.keyLicenseFileJson });
    expect(bookkeeperRes.status).toBe(403);
    expect(bookkeeperRes.body.error).toBe('PERMISSION_DENIED');
  });
});
