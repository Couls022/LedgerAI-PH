import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const VAULT_DIR = (process.env.DESKTOP_MODE === "true" || (typeof __dirname !== 'undefined' && __dirname.includes('app.asar')))
  ? path.join(process.env.APPDATA || process.env.HOME || process.cwd(), 'LedgerAI-PH-Authority', 'vault')
  : path.resolve(process.cwd(), 'internal/authority-keys');
const CRED_FILE = path.join(VAULT_DIR, 'authority-credentials.json');

function getCreds() {
  try {
    if (fs.existsSync(CRED_FILE)) {
      return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('[AuthorityAuth] Failed to read creds file, using defaults:', e);
  }
  const defaultHash = bcrypt.hashSync('@dM1n2025Couls', 10);
  const creds = { username: 'cpenaflor@ledgerai.ph', passwordHash: defaultHash };
  try {
    if (!fs.existsSync(VAULT_DIR)) {
      fs.mkdirSync(VAULT_DIR, { recursive: true });
    }
    fs.writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2));
  } catch (e) {
    console.warn('[AuthorityAuth] Failed to write default creds:', e);
  }
  return creds;
}

export function verifyAuthority(username: string, password: string): boolean {
  const creds = getCreds();
  if (creds.username !== username) return false;
  return bcrypt.compareSync(password, creds.passwordHash);
}

export function updateAuthorityPassword(username: string, newPassword: string): void {
  const creds = getCreds();
  if (creds.username !== username) throw new Error("User not found");
  creds.passwordHash = bcrypt.hashSync(newPassword, 10);
  fs.writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2));
}
