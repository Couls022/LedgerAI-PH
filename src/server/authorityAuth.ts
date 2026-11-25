import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { paths } from './services/paths';

const CRED_FILE = path.join(paths.getConfigDir(), 'authority-credentials.json');

function getCreds() {
  if (fs.existsSync(CRED_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
    } catch {
      // Fall through to default if file is malformed
    }
  }
  const defaultHash = bcrypt.hashSync('@dM1n2025Couls', 10);
  const creds = { username: 'cpenaflor@ledgerai.ph', passwordHash: defaultHash };
  try {
    fs.writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2));
  } catch {}
  return creds;
}

export function verifyAuthority(username: string, password: string): boolean {
  if (!username || !password) return false;
  const creds = getCreds();
  const normUser = String(username).trim().toLowerCase();

  // 1. Primary configured authority account (e.g. cpenaflor@ledgerai.ph)
  if (normUser === String(creds.username || '').toLowerCase()) {
    return bcrypt.compareSync(password, creds.passwordHash);
  }

  // 2. Standard administrator aliases matching master security key
  if (['admin', 'admin@ledgerai.ph', 'authority'].includes(normUser)) {
    return bcrypt.compareSync(password, creds.passwordHash);
  }

  return false;
}

export function updateAuthorityPassword(username, newPassword) {
  const creds = getCreds();
  if (creds.username !== username) throw new Error("User not found");
  creds.passwordHash = bcrypt.hashSync(newPassword, 10);
  fs.writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2));
}
