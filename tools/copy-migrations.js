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

  // Ensure icons are populated in dist and dist-authority
  const appIcon = path.resolve(__dirname, '../packaging/windows/assets/app-icon.ico');
  const keyIcon = path.resolve(__dirname, '../packaging/windows/assets/keygenerator-icon.ico');

  if (fs.existsSync(appIcon)) {
    fs.copyFileSync(appIcon, path.resolve(__dirname, '../dist/favicon.ico'));
    fs.copyFileSync(appIcon, path.resolve(__dirname, '../dist/app-icon.ico'));
    console.log('[Build] Successfully copied app icons to dist/favicon.ico');
  }

  const distAuthDir = path.resolve(__dirname, '../dist-authority');
  if (fs.existsSync(keyIcon) && fs.existsSync(distAuthDir)) {
    fs.copyFileSync(keyIcon, path.resolve(distAuthDir, 'favicon.ico'));
    fs.copyFileSync(keyIcon, path.resolve(distAuthDir, 'keygenerator-icon.ico'));
    console.log('[Build] Successfully copied keygenerator icons to dist-authority/favicon.ico');
  }
} catch (err) {
  console.error('[Build Error] Failed to copy migrations:', err);
  process.exit(1);
}
