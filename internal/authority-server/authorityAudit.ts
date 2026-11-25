import fs from 'fs';
import path from 'path';

const VAULT_DIR = (process.env.DESKTOP_MODE === "true" || (typeof __dirname !== 'undefined' && __dirname.includes('app.asar')))
  ? path.join(process.env.APPDATA || process.env.HOME || process.cwd(), 'LedgerAI-PH-Authority', 'vault')
  : path.resolve(process.cwd(), 'internal/authority-keys');
const AUDIT_FILE = path.join(VAULT_DIR, 'authority-audit.log');

export function logAuthorityAction(actor: string, action: string, details: any) {
  const entry = {
    timestamp: new Date().toISOString(),
    actor,
    action,
    details
  };
  try {
    if (!fs.existsSync(VAULT_DIR)) {
      fs.mkdirSync(VAULT_DIR, { recursive: true });
    }
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.warn('[AuthorityAudit] Failed to write log:', e);
  }
}
