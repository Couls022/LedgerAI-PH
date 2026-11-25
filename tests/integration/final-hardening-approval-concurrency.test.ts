import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import request from 'supertest';

const { tempRoot } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('node:path');
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'ledgerai-p1-concurrency-'));
  process.env.LEDGERAI_CONFIG_DIR = nodePath.join(root, 'config');
  process.env.LEDGERAI_DATA_DIR = nodePath.join(root, 'data');
  return { tempRoot: root };
});

import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { RbacService } from '../../src/server/services/rbacService';
import { hashToken } from '../../src/server/auth';
import { dbContext } from '../../src/server/db/context';
import { AccountingEngine } from '../../src/server/services/accountingEngine';

const COMP_ID = 'LGR-PH-P1-CONCURRENCY';

describe('PRIORITY 1 — APPROVAL CONCURRENCY & DISTRIBUTED EXECUTION SAFETY', () => {
  const app = createApp();

  const creatorId = 'usr-p1-creator';
  const approver1Id = 'usr-p1-approver-1';
  const approver2Id = 'usr-p1-approver-2';
  const delegateId = 'usr-p1-delegate';
  const limitedApproverId = 'usr-p1-limited';

  let creatorToken = '';
  let approver1Token = '';
  let approver2Token = '';
  let delegateToken = '';
  let limitedApproverToken = '';

  let vendorId = '';
  let expenseAccountId = '';

  beforeAll(async () => {
    await CompanyManager.createCompanyProfile(COMP_ID, 'Priority 1 Concurrency Corp.', undefined, undefined, false, {
      classification: 'TEST',
    });
    const sqlite = await CompanyManager.getCompanySqlite(COMP_ID);
    const companyDb = await CompanyManager.getCompanyDb(COMP_ID);
    const now = Date.now();

    sqlite.exec(`
      INSERT OR REPLACE INTO companies (id, legal_name, tin, vat_status, taxpayer_classification, currency, status, classification)
      VALUES ('${COMP_ID}', 'Priority 1 Concurrency Corp.', '111-222-333-000', 'VAT', 'CORPORATION', 'PHP', 'ACTIVE', 'TEST');
    `);

    await dbContext.run(companyDb as any, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      await AccountingEngine.ensureDefaultAccounts(COMP_ID);

      sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounting_periods (id, company_id, name, start_date, end_date, fiscal_year, status, created_at, updated_at)
           VALUES (?, ?, 'FY 2026', '2026-01-01', '2026-12-31', 2026, 'OPEN', ?, ?)`
        )
        .run(`per-${COMP_ID}-2026`, COMP_ID, now, now);

      const expAcc = sqlite
        .prepare(`SELECT id FROM accounts WHERE company_id = ? AND account_type = 'EXPENSE' LIMIT 1`)
        .get(COMP_ID) as { id: string } | undefined;
      expenseAccountId = expAcc?.id || 'acc-exp-p1';

      vendorId = `vnd-${COMP_ID}-01`;
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO vendors (id, company_id, code, legal_name, tin, address, status, created_at, updated_at)
           VALUES (?, ?, 'VND-P1-01', 'Metro Supplier Inc.', '222-333-444-000', 'Makati City', 'ACTIVE', ?, ?)`
        )
        .run(vendorId, COMP_ID, now, now);

      const users = [
        { id: creatorId, email: 'creator@p1.ph', displayName: 'Creator Bookkeeper', roleName: 'Company Administrator', approvalLimit: 50_000_000_00 },
        { id: approver1Id, email: 'approver1@p1.ph', displayName: 'Approver One', roleName: 'Company Owner', approvalLimit: 50_000_000_00 },
        { id: approver2Id, email: 'approver2@p1.ph', displayName: 'Approver Two', roleName: 'Company Owner', approvalLimit: 50_000_000_00 },
        { id: delegateId, email: 'delegate@p1.ph', displayName: 'Delegate Owner', roleName: 'Company Owner', approvalLimit: 50_000_000_00 },
        { id: limitedApproverId, email: 'limited@p1.ph', displayName: 'Limited Approver', roleName: 'Company Administrator', roleNames: ['Company Administrator', 'Approver'], approvalLimit: 100_000_00 },
      ];

      const tokens: Record<string, string> = {};
      for (const u of users) {
        sqlite
          .prepare(
            `INSERT OR REPLACE INTO users (id, email, password_hash, display_name, status, is_demo, require_password_change, created_at, updated_at)
             VALUES (?, ?, 'hash', ?, 'ACTIVE', 1, 0, ?, ?)`
          )
          .run(u.id, u.email, u.displayName, now, now);

        const cuId = `cu-${COMP_ID}-${u.id}`;
        sqlite
          .prepare(
            `INSERT OR REPLACE INTO company_users (id, user_id, company_id, legacy_role, status, membership_status, default_data_scope, approval_limit_centavos, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'ACTIVE', 'ACTIVE', 'COMPANY_WIDE', ?, ?, ?)`
          )
          .run(cuId, u.id, COMP_ID, u.roleName, u.approvalLimit, now, now);

        await RbacService.setMemberRoles(null, cuId, (u.roleNames || [u.roleName]) as any, 'P1 concurrency setup');
        sqlite.prepare(`UPDATE company_users SET approval_limit_centavos = ? WHERE id = ?`).run(u.approvalLimit, cuId);

        const rawToken = crypto.randomBytes(32).toString('hex');
        sqlite
          .prepare(`INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`)
          .run(hashToken(rawToken), u.id, now + 86400_000, now);
        tokens[u.id] = `${COMP_ID}.${rawToken}`;
      }

      creatorToken = tokens[creatorId];
      approver1Token = tokens[approver1Id];
      approver2Token = tokens[approver2Id];
      delegateToken = tokens[delegateId];
      limitedApproverToken = tokens[limitedApproverId];
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  async function createBillAndWorkflow(amountCentavos: number, requiredRole: string = 'Company Owner'): Promise<{ billId: string; workflowId: string; stepId: string }> {
    const sqlite = await CompanyManager.getCompanySqlite(COMP_ID);
    const billId = `bill-p1-${crypto.randomUUID().slice(0, 8)}`;
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, status, total_amount, balance_due, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, '2026-03-10', '2026-04-10', 'SUBMITTED', ?, ?, ?, ?, ?)`
      )
      .run(billId, COMP_ID, vendorId, `BILL-${billId.toUpperCase()}`, amountCentavos, amountCentavos, creatorId, now, now);

    sqlite
      .prepare(
        `INSERT INTO purchase_bill_lines (id, bill_id, account_id, description, quantity, unit_price, amount, created_at)
         VALUES (?, ?, ?, 'Server rack equipment', 1, ?, ?, ?)`
      )
      .run(`bline-${billId}`, billId, expenseAccountId, amountCentavos, amountCentavos, now);

    const initRes = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        entityType: 'PURCHASE_BILL',
        entityId: billId,
        amountCentavos,
        steps: [{ stepName: 'Step 1 Approval', requiredRole, slaHours: 24 }],
      });

    expect([200, 201]).toContain(initRes.status);
    const workflowId = initRes.body.workflowId || initRes.body.workflow?.id;
    const stepId = initRes.body.steps?.[0]?.id;
    expect(workflowId).toBeTruthy();
    expect(stepId).toBeTruthy();

    return { billId, workflowId, stepId };
  }

  it('1. enforces atomic optimistic concurrency across two different users approving the same step simultaneously', async () => {
    const { workflowId, stepId } = await createBillAndWorkflow(25_000_00);

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/journey/approvals/${workflowId}/decide`)
        .set('Authorization', `Bearer ${approver1Token}`)
        .send({ stepId, decision: 'APPROVED', comments: 'Approver 1 concurrent decision' }),
      request(app)
        .post(`/api/journey/approvals/${workflowId}/decide`)
        .set('Authorization', `Bearer ${approver2Token}`)
        .send({ stepId, decision: 'APPROVED', comments: 'Approver 2 concurrent decision' }),
    ]);

    const statuses = [res1.status, res2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const sqlite = await CompanyManager.getCompanySqlite(COMP_ID);
    const wfRow = sqlite.prepare(`SELECT status, version FROM approval_workflows WHERE id = ?`).get(workflowId) as any;
    const stepRow = sqlite.prepare(`SELECT status, version, actual_approver_id FROM approval_steps WHERE id = ?`).get(stepId) as any;
    expect(wfRow.status).toBe('APPROVED');
    expect(wfRow.version).toBe(2);
    expect(stepRow.status).toBe('APPROVED');
    expect(stepRow.version).toBe(2);
    expect([approver1Id, approver2Id]).toContain(stepRow.actual_approver_id);
  });

  it('2. enforces cross-process SQLite BEGIN IMMEDIATE + version concurrency when a separate worker process approves simultaneously', async () => {
    const { workflowId, stepId } = await createBillAndWorkflow(30_000_00);
    const sqliteMain = await CompanyManager.getCompanySqlite(COMP_ID);
    try {
      sqliteMain.pragma('wal_checkpoint(PASSIVE)');
    } catch {
      // ignore
    }

    const workerCode = `
      import request from 'supertest';
      import { createApp } from './src/server/app.ts';
      import { CompanyManager } from './src/server/services/companyManager.ts';

      async function main() {
        const app = createApp();
        await CompanyManager.getCompanyDb('${COMP_ID}');
        process.stdout.write('WORKER_READY\\n');

        await new Promise((resolve) => {
          process.stdin.once('data', () => resolve(undefined));
        });

        const res = await request(app)
          .post('/api/journey/approvals/${workflowId}/decide')
          .set('Authorization', 'Bearer ${approver2Token}')
          .send({ stepId: '${stepId}', decision: 'APPROVED', comments: 'Separate OS Process Approval' });
        process.stdout.write('WORKER_RESULT:' + JSON.stringify({ status: res.status, body: res.body }) + '\\n');
        await CompanyManager.closeAllConnections();
        process.exit(0);
      }
      main().catch((err) => {
        process.stdout.write('WORKER_ERROR:' + JSON.stringify({ message: String(err?.message || err) }) + '\\n');
        process.exit(1);
      });
    `;

    const child = spawn(process.execPath, ['--import', 'tsx', '-e', workerCode], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        VITEST: 'true',
        LEDGERAI_CONFIG_DIR: process.env.LEDGERAI_CONFIG_DIR,
        LEDGERAI_DATA_DIR: process.env.LEDGERAI_DATA_DIR,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    await new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        if (stdoutBuf.includes('WORKER_READY')) {
          child.stdout.off('data', onData);
          resolve();
        } else if (stdoutBuf.includes('WORKER_ERROR:')) {
          child.stdout.off('data', onData);
          reject(new Error('Worker initialization failed: ' + stdoutBuf.replace(/\s+/g, ' ')));
        }
      };
      child.stdout.on('data', onData);
      child.once('exit', (code) => {
        if (!stdoutBuf.includes('WORKER_READY')) {
          reject(new Error(`Worker exited early with code ${code}: ${stderrBuf.slice(0, 200).replace(/\s+/g, ' ')}`));
        }
      });
    });

    const waitForWorkerResult = new Promise<{ status: number; body: any }>((resolve, reject) => {
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
      });
      child.once('close', () => {
        const resLine = stdoutBuf
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.startsWith('WORKER_RESULT:'));
        if (!resLine) {
          return reject(new Error('Missing WORKER_RESULT from child process'));
        }
        resolve(JSON.parse(resLine.slice('WORKER_RESULT:'.length)));
      });
    });

    // Release barrier so both OS processes fire /decide concurrently
    child.stdin.write('GO\n');

    const [externalResult, inProcessResult] = await Promise.all([
      waitForWorkerResult,
      request(app)
        .post(`/api/journey/approvals/${workflowId}/decide`)
        .set('Authorization', `Bearer ${approver1Token}`)
        .send({ stepId, decision: 'APPROVED', comments: 'Main Process Approval' })
        .then((res) => ({ status: res.status, body: res.body })),
    ]);

    const combinedStatuses = [externalResult.status, inProcessResult.status].sort((a, b) => a - b);
    expect(combinedStatuses).toEqual([200, 409]);

    const sqlite = await CompanyManager.getCompanySqlite(COMP_ID);
    const stepRow = sqlite.prepare(`SELECT status, version FROM approval_steps WHERE id = ?`).get(stepId) as any;
    expect(stepRow.status).toBe('APPROVED');
    expect(stepRow.version).toBe(2);
  });

  it('3. handles retried requests and duplicate requests with the same Idempotency-Key idempotently without double mutation', async () => {
    const { workflowId, stepId } = await createBillAndWorkflow(18_500_00);
    const idemKey = `idem-p1-${crypto.randomUUID()}`;

    const firstRes = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .set('Idempotency-Key', idemKey)
      .send({ stepId, decision: 'APPROVED', comments: 'Initial decision with idempotency key' });

    expect(firstRes.status).toBe(200);
    expect(firstRes.body.workflow.status).toBe('APPROVED');

    // Retried request with the EXACT SAME Idempotency-Key returns cached 200 response
    const retryRes = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .set('Idempotency-Key', idemKey)
      .send({ stepId, decision: 'APPROVED', comments: 'Initial decision with idempotency key' });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.idempotentReplay).toBe(true);
    expect(retryRes.body.workflow.status).toBe('APPROVED');

    // Reusing the SAME Idempotency-Key with a DIFFERENT payload is rejected with 409 IDEMPOTENCY_KEY_CONFLICT
    const payloadMismatchRes = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .set('Idempotency-Key', idemKey)
      .send({ stepId, decision: 'REJECTED', comments: 'Mutated payload under same idempotency key' });

    expect(payloadMismatchRes.status).toBe(409);
    expect(payloadMismatchRes.body.error).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(payloadMismatchRes.body.code).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');

    // A request with a DIFFERENT Idempotency-Key on the already-decided step gets 409 Conflict
    const differentKeyRes = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .set('Idempotency-Key', `${idemKey}-different`)
      .send({ stepId, decision: 'APPROVED', comments: 'Different key retry' });

    expect(differentKeyRes.status).toBe(409);

    const sqlite = await CompanyManager.getCompanySqlite(COMP_ID);
    const stepRow = sqlite.prepare(`SELECT version FROM approval_steps WHERE id = ?`).get(stepId) as any;
    expect(stepRow.version).toBe(2);
  });

  it('4. blocks approval after workflow cancellation with 400 TRANSACTION_CANCELLED', async () => {
    const { workflowId, stepId } = await createBillAndWorkflow(12_000_00);

    const cancelRes = await request(app)
      .post(`/api/journey/approvals/${workflowId}/cancel`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ reason: 'Vendor revised quote' });
    expect(cancelRes.status).toBe(200);

    const decideAfterCancel = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ stepId, decision: 'APPROVED', comments: 'Late approval attempt' });
    expect([400, 409]).toContain(decideAfterCancel.status);
    expect(decideAfterCancel.body.error).toBe('TRANSACTION_CANCELLED');
  });

  it('5. enforces strict assignee & SoD validation after delegation or reassignment', async () => {
    const { workflowId, stepId } = await createBillAndWorkflow(22_000_00);

    // Reassign step specifically to approver1Id first
    const reassignRes = await request(app)
      .post(`/api/journey/approvals/${workflowId}/reassign`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ stepId, newApproverId: approver1Id, reason: 'Lock step to Approver 1' });
    expect(reassignRes.status).toBe(200);

    // Approver 2 (not the assigned user) is rejected with 403 UNAUTHORIZED_STEP_ASSIGNEE
    const wrongUserAttempt = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${approver2Token}`)
      .send({ stepId, decision: 'APPROVED', comments: 'Unassigned approver attempt' });
    expect(wrongUserAttempt.status).toBe(403);
    expect(wrongUserAttempt.body.error).toBe('UNAUTHORIZED_STEP_ASSIGNEE');

    // Delegate back to creator -> blocked either at delegation or at decision by SoD
    const delegateToCreator = await request(app)
      .post(`/api/journey/approvals/${workflowId}/delegate`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ stepId, toUserId: creatorId, reason: 'Try delegating back to creator' });
    expect([200, 403]).toContain(delegateToCreator.status);

    const creatorSelfApprove = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ stepId, decision: 'APPROVED', comments: 'Creator self-approval via delegation' });
    expect(creatorSelfApprove.status).toBe(403);

    // Now reassign to delegateId (a valid independent approver)
    const reassignValid = await request(app)
      .post(`/api/journey/approvals/${workflowId}/reassign`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ stepId, newApproverId: delegateId, reason: 'Assign to Delegate Owner' });
    expect(reassignValid.status).toBe(200);

    // Original approver1Id can no longer approve since step is assigned to delegateId
    const oldAssigneeAttempt = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ stepId, decision: 'APPROVED', comments: 'Stale assignee attempt' });
    expect(oldAssigneeAttempt.status).toBe(403);

    // Delegate user approves successfully
    const validDelegateApprove = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${delegateToken}`)
      .send({ stepId, decision: 'APPROVED', comments: 'Valid delegate decision' });
    expect(validDelegateApprove.status).toBe(200);
    expect(validDelegateApprove.body.workflow.status).toBe('APPROVED');
  });

  it('6. blocks approval with 409 AMOUNT_MUTATED_AFTER_SUBMISSION when underlying transaction amount is modified after workflow initiation', async () => {
    const { billId, workflowId, stepId } = await createBillAndWorkflow(40_000_00);

    const sqlite = await CompanyManager.getCompanySqlite(COMP_ID);
    sqlite.prepare(`UPDATE purchase_bills SET total_amount = 9500000 WHERE id = ?`).run(billId);

    const tamperRes = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ stepId, decision: 'APPROVED', comments: 'Approve tampered bill' });

    expect(tamperRes.status).toBe(409);
    expect(tamperRes.body.code).toBe('AMOUNT_MUTATED_AFTER_SUBMISSION');
  });

  it('7. enforces live DB approval-limit checks inside the transaction when approver limit is lowered before decision', async () => {
    const { workflowId, stepId } = await createBillAndWorkflow(80_000_00, 'Approver');

    const sqlite = await CompanyManager.getCompanySqlite(COMP_ID);
    sqlite
      .prepare(`UPDATE company_users SET approval_limit_centavos = 5000000 WHERE company_id = ? AND user_id = ?`)
      .run(COMP_ID, limitedApproverId);

    const limitRes = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${limitedApproverToken}`)
      .send({ stepId, decision: 'APPROVED', comments: 'Attempt approval after limit reduction' });

    expect(limitRes.status).toBe(403);
    expect(limitRes.body.error).toBe('APPROVAL_LIMIT_EXCEEDED');
  });

  it('8. recovers SQLite WAL cleanly after abrupt OS worker process termination (SIGKILL) during uncommitted write without duplicate or corrupted approval records', async () => {
    const { workflowId, stepId } = await createBillAndWorkflow(35_000_00);

    const crashWorkerCode = `
      import { CompanyManager } from './src/server/services/companyManager.ts';

      async function main() {
        const sqlite = await CompanyManager.getCompanySqlite('${COMP_ID}');
        sqlite.exec('BEGIN IMMEDIATE');
        sqlite.prepare("UPDATE approval_steps SET status = 'APPROVED', version = 99 WHERE id = ?").run('${stepId}');
        sqlite.prepare("UPDATE approval_workflows SET status = 'APPROVED', version = 99 WHERE id = ?").run('${workflowId}');
        process.stdout.write('LOCKED_UNCOMMITTED\\n');
        setInterval(() => {}, 1000);
      }
      main().catch((err) => {
        process.stdout.write('CRASH_ERR:' + String(err) + '\\n');
        process.exit(1);
      });
    `;

    const child = spawn(process.execPath, ['--import', 'tsx', '-e', crashWorkerCode], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        VITEST: 'true',
        LEDGERAI_CONFIG_DIR: process.env.LEDGERAI_CONFIG_DIR,
        LEDGERAI_DATA_DIR: process.env.LEDGERAI_DATA_DIR,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
        if (out.includes('LOCKED_UNCOMMITTED')) resolve();
        else if (out.includes('CRASH_ERR:')) reject(new Error(out));
      });
      child.once('exit', (code) => {
        if (!out.includes('LOCKED_UNCOMMITTED')) {
          reject(new Error(`Crash worker exited prematurely (${code}): ${out}`));
        }
      });
    });

    // Abruptly terminate the child OS process via SIGKILL while holding the uncommitted BEGIN IMMEDIATE write lock
    await new Promise<void>((resolve) => {
      child.once('close', () => resolve());
      child.kill('SIGKILL');
    });

    const sqlite = await CompanyManager.getCompanySqlite(COMP_ID);
    const integrity = sqlite.pragma('integrity_check') as Array<{ integrity_check: string }>;
    expect(integrity[0]?.integrity_check).toBe('ok');

    // Verify the uncommitted transaction was rolled back automatically by SQLite WAL recovery
    const preStep = sqlite.prepare(`SELECT status, version FROM approval_steps WHERE id = ?`).get(stepId) as any;
    const preWf = sqlite.prepare(`SELECT status, version FROM approval_workflows WHERE id = ?`).get(workflowId) as any;
    expect(preStep.status).toBe('PENDING');
    expect(preStep.version).toBe(1);
    expect(preWf.status).toBe('IN_PROGRESS');
    expect(preWf.version).toBe(1);

    // Verify normal approval now succeeds cleanly with no residual lock or duplicate record
    const recoverRes = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ stepId, decision: 'APPROVED', comments: 'Approved cleanly after OS worker SIGKILL recovery' });
    expect(recoverRes.status).toBe(200);
    expect(recoverRes.body.workflow.status).toBe('APPROVED');

    const postStep = sqlite.prepare(`SELECT status, version FROM approval_steps WHERE id = ?`).get(stepId) as any;
    const stepCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM approval_steps WHERE workflow_id = ?`).get(workflowId) as any).c;
    expect(postStep.status).toBe('APPROVED');
    expect(postStep.version).toBe(2);
    expect(stepCount).toBe(1);
  });
});
