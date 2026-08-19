import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { paths } from './services/paths';

const CRED_FILE = path.join(paths.getConfigDir(), 'authority-credentials.json');

function getCreds() {
  if (fs.existsSync(CRED_FILE)) {
    return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
  }
  const defaultHash = bcrypt.hashSync('@dM1n2025Couls', 10);
  const creds = { username: 'cpenaflor@ledgerai.ph', passwordHash: defaultHash };
  fs.writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2));
  return creds;
}

export function verifyAuthority(username, password) {
  const creds = getCreds();
  if (creds.username !== username) return false;
  return bcrypt.compareSync(password, creds.passwordHash);
}

export function updateAuthorityPassword(username, newPassword) {
  const creds = getCreds();
  if (creds.username !== username) throw new Error("User not found");
  creds.passwordHash = bcrypt.hashSync(newPassword, 10);
  fs.writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2));
}
