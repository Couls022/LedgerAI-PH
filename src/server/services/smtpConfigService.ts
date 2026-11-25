import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { dbContext } from '../db/context';
import { DocumentEncryptionService } from './documentEncryptionService';

const SMTP_ENC_PREFIX = 'enc:smtp:v1:';

export interface SmtpSettingsInput {
  host: string;
  port: string | number;
  user: string;
  pass?: string;
  ssl?: boolean;
  sender?: string;
  subjectTemplate?: string;
  bodyTemplate?: string;
  keepExistingPassword?: boolean;
}

export interface SmtpPublicConfig {
  configured: boolean;
  host: string;
  port: string;
  user: string;
  hasPassword: boolean;
  ssl: boolean;
  sender: string;
  subjectTemplate: string;
  bodyTemplate: string;
  updatedAt: string | null;
}

export interface SmtpTransportConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  ssl: boolean;
  sender: string;
  subjectTemplate: string;
  bodyTemplate: string;
}

function getRawSqliteClient(): any {
  const activeDb = dbContext.getStore() as any;
  const client = activeDb?.$client || activeDb?.session?.client;
  if (!client) {
    throw new Error('NO_ACTIVE_DATABASE: No active SQLite company database context for SMTP configuration.');
  }
  return client;
}

function ensureSmtpTable(client: any) {
  client.exec(`
    CREATE TABLE IF NOT EXISTS company_smtp_settings (
      company_id TEXT PRIMARY KEY,
      smtp_host TEXT NOT NULL,
      smtp_port INTEGER NOT NULL DEFAULT 587,
      smtp_user TEXT NOT NULL,
      encrypted_smtp_pass TEXT NOT NULL,
      use_ssl INTEGER NOT NULL DEFAULT 0,
      sender_email TEXT NOT NULL DEFAULT '',
      subject_template TEXT NOT NULL DEFAULT 'LedgerAI Backup Notification - {{STATUS}}',
      body_template TEXT NOT NULL DEFAULT 'A local backup was completed on {{TIMESTAMP}}.\nStatus: {{STATUS}}',
      updated_by TEXT,
      updated_at TEXT NOT NULL
    )
  `);
}

function encryptSmtpSecret(companyId: string, plainSecret: string): string {
  const trimmed = plainSecret;
  if (!trimmed) return '';
  const masterKey = DocumentEncryptionService.deriveCompanyDocumentMasterKey(companyId);
  const keyDek = Buffer.from(
    crypto.hkdfSync(
      'sha256',
      masterKey,
      Buffer.from(`smtp-key-salt:${companyId}`, 'utf8'),
      Buffer.from('ledgerai-ph:smtp-credential-dek:v1', 'utf8'),
      32
    )
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyDek, iv);
  cipher.setAAD(Buffer.from(`company:${companyId}:smtp-credential`, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(Buffer.from(trimmed, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SMTP_ENC_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

function decryptSmtpSecret(companyId: string, storedValue?: string | null): string {
  if (!storedValue) return '';
  if (!storedValue.startsWith(SMTP_ENC_PREFIX)) return storedValue;
  try {
    const payload = Buffer.from(storedValue.slice(SMTP_ENC_PREFIX.length), 'base64');
    if (payload.length < 28) return '';
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const masterKey = DocumentEncryptionService.deriveCompanyDocumentMasterKey(companyId);
    const keyDek = Buffer.from(
      crypto.hkdfSync(
        'sha256',
        masterKey,
        Buffer.from(`smtp-key-salt:${companyId}`, 'utf8'),
        Buffer.from('ledgerai-ph:smtp-credential-dek:v1', 'utf8'),
        32
      )
    );
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyDek, iv);
    decipher.setAAD(Buffer.from(`company:${companyId}:smtp-credential`, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export class SmtpConfigService {
  static extractValidEmail(rawContact?: string | null): string | null {
    if (!rawContact || typeof rawContact !== 'string') return null;
    const trimmed = rawContact.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        const candidates = [
          parsed?.email,
          parsed?.contactEmail,
          parsed?.billingEmail,
          parsed?.mail,
        ];
        for (const c of candidates) {
          if (typeof c === 'string') {
            const match = c.trim().match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (match) return match[0];
          }
        }
      } catch {
        // Fall through to regex scan
      }
    }

    const match = trimmed.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return match ? match[0] : null;
  }

  static getPublicConfig(companyId: string): SmtpPublicConfig {
    const client = getRawSqliteClient();
    ensureSmtpTable(client);

    const row = client
      .prepare('SELECT * FROM company_smtp_settings WHERE company_id = ?')
      .get(companyId) as any;

    if (!row) {
      return {
        configured: false,
        host: '',
        port: '587',
        user: '',
        hasPassword: false,
        ssl: false,
        sender: '',
        subjectTemplate: 'LedgerAI Notification - {{STATUS}}',
        bodyTemplate: 'A system event completed on {{TIMESTAMP}}.\nStatus: {{STATUS}}',
        updatedAt: null,
      };
    }

    const hasPassword = Boolean(row.encrypted_smtp_pass && String(row.encrypted_smtp_pass).trim().length > 0);
    return {
      configured: Boolean(row.smtp_host && row.smtp_user && hasPassword),
      host: String(row.smtp_host || ''),
      port: String(row.smtp_port || '587'),
      user: String(row.smtp_user || ''),
      hasPassword,
      ssl: Boolean(row.use_ssl),
      sender: String(row.sender_email || ''),
      subjectTemplate: String(row.subject_template || 'LedgerAI Notification - {{STATUS}}'),
      bodyTemplate: String(row.body_template || 'A system event completed on {{TIMESTAMP}}.\nStatus: {{STATUS}}'),
      updatedAt: row.updated_at ? String(row.updated_at) : null,
    };
  }

  static getTransportConfig(companyId: string): SmtpTransportConfig | null {
    const client = getRawSqliteClient();
    ensureSmtpTable(client);
    const row = client
      .prepare('SELECT * FROM company_smtp_settings WHERE company_id = ?')
      .get(companyId) as any;

    if (!row || !row.smtp_host || !row.smtp_user) return null;
    const pass = decryptSmtpSecret(companyId, row.encrypted_smtp_pass);
    if (!pass) return null;

    return {
      host: String(row.smtp_host),
      port: Number(row.smtp_port || 587),
      user: String(row.smtp_user),
      pass,
      ssl: Boolean(row.use_ssl),
      sender: String(row.sender_email || row.smtp_user),
      subjectTemplate: String(row.subject_template || 'LedgerAI Notification - {{STATUS}}'),
      bodyTemplate: String(row.body_template || 'A system event completed on {{TIMESTAMP}}.\nStatus: {{STATUS}}'),
    };
  }

  static saveConfig(companyId: string, input: SmtpSettingsInput, userId?: string): SmtpPublicConfig {
    const client = getRawSqliteClient();
    ensureSmtpTable(client);

    const existing = client
      .prepare('SELECT encrypted_smtp_pass FROM company_smtp_settings WHERE company_id = ?')
      .get(companyId) as any;

    const cleanHost = String(input.host || '').trim();
    const portNum = parseInt(String(input.port || '587'), 10);
    const cleanUser = String(input.user || '').trim();
    const cleanSender = String(input.sender || '').trim();

    if (!cleanHost || !/^[\w.-]+$/.test(cleanHost)) {
      throw new Error('Valid SMTP Host is required.');
    }
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error('SMTP Port must be between 1 and 65535.');
    }
    if (!cleanUser) {
      throw new Error('SMTP Username is required.');
    }
    if (cleanSender && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanSender)) {
      throw new Error('Sender Email Address is invalid.');
    }

    let encryptedPass = existing?.encrypted_smtp_pass ? String(existing.encrypted_smtp_pass) : '';
    if (typeof input.pass === 'string' && input.pass.length > 0) {
      encryptedPass = encryptSmtpSecret(companyId, input.pass);
    }

    if (!encryptedPass) {
      throw new Error('SMTP Password is required.');
    }

    const updatedAt = new Date().toISOString();
    client
      .prepare(`
        INSERT INTO company_smtp_settings (
          company_id, smtp_host, smtp_port, smtp_user, encrypted_smtp_pass,
          use_ssl, sender_email, subject_template, body_template, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(company_id) DO UPDATE SET
          smtp_host = excluded.smtp_host,
          smtp_port = excluded.smtp_port,
          smtp_user = excluded.smtp_user,
          encrypted_smtp_pass = excluded.encrypted_smtp_pass,
          use_ssl = excluded.use_ssl,
          sender_email = excluded.sender_email,
          subject_template = excluded.subject_template,
          body_template = excluded.body_template,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `)
      .run(
        companyId,
        cleanHost,
        portNum,
        cleanUser,
        encryptedPass,
        input.ssl ? 1 : 0,
        cleanSender,
        String(input.subjectTemplate || 'LedgerAI Notification - {{STATUS}}').trim(),
        String(input.bodyTemplate || 'A system event completed on {{TIMESTAMP}}.\nStatus: {{STATUS}}').trim(),
        userId || null,
        updatedAt
      );

    return this.getPublicConfig(companyId);
  }

  static createTransporter(cfg: Pick<SmtpTransportConfig, 'host' | 'port' | 'user' | 'pass' | 'ssl'>) {
    return nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.ssl === true || cfg.port === 465,
      auth: {
        user: cfg.user,
        pass: cfg.pass,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  static async sendMail(
    companyId: string,
    params: { to: string; subject: string; text: string; html?: string }
  ): Promise<{ messageId: string; from: string; to: string }> {
    const cfg = this.getTransportConfig(companyId);
    if (!cfg) {
      throw new Error('SMTP_NOT_CONFIGURED');
    }
    const transporter = this.createTransporter(cfg);
    const from = cfg.sender || cfg.user;
    const info = await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    return {
      messageId: String(info?.messageId || ''),
      from,
      to: params.to,
    };
  }
}
