import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = path.resolve(__dirname, '../src/server/db/migrations');
const targetDir = path.resolve(__dirname, '../dist/migrations');

try {
  if (fs.existsSync(sourceDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true });
    console.log('[Build] Successfully copied migrations to dist/migrations');
  } else {
    console.warn('[Build Warning] Migrations directory not found at:', sourceDir);
  }
} catch (err) {
  console.error('[Build Error] Failed to copy migrations:', err);
  process.exit(1);
}
