import fs from 'fs';
import path from 'path';
import { paths } from './services/paths';

const AUDIT_FILE = path.join(paths.getConfigDir(), 'authority-audit.log');

export function logAuthorityAction(actor: string, action: string, details: any) {
  const entry = {
    timestamp: new Date().toISOString(),
    actor,
    action,
    details
  };
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
}
