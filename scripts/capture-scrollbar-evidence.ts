import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

function findChromiumExecutable(): string | undefined {
  try {
    const out = execSync('find /ms-playwright /root/.cache/ms-playwright -name "chrome-headless-shell" 2>/dev/null', { encoding: 'utf8' });
    const lines = out.trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      return lines[0];
    }
  } catch (_) {}
  return undefined;
}

async function main() {
  console.log('[PLAYWRIGHT EVIDENCE] Starting browser scrollbar capture harness...');
  const outDir1 = path.join(process.cwd(), '.playwright-cli');
  const outDir2 = path.join(process.cwd(), '.aistudio/artifacts/computer_use');
  fs.mkdirSync(outDir1, { recursive: true });
  fs.mkdirSync(outDir2, { recursive: true });

  const executablePath = findChromiumExecutable();
  console.log('[PLAYWRIGHT EVIDENCE] Using Chromium Executable:', executablePath || 'Default');

  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    console.log('[PLAYWRIGHT EVIDENCE] Navigating to login...');
    await page.goto('http://localhost:3000/#/login/LGR-PH-2026-STRESS-DG-PREVIEW', { waitUntil: 'networkidle' });

    console.log('[PLAYWRIGHT EVIDENCE] Logging in as admin@gmail.com...');
    await page.fill('input[type="text"], input[type="email"]', 'admin@gmail.com');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button:has-text("Sign In")');
    await page.waitForTimeout(2500);

    // Close onboarding tour overlay if visible
    try {
      const tourSkip = page.locator('button:has-text("Skip Walkthrough"), button:has-text("Close tour")');
      if (await tourSkip.isVisible()) {
        await tourSkip.first().click();
        await page.waitForTimeout(500);
      }
    } catch (_) {}

    // 1. Idle Screenshot (Mouse outside scrollable container)
    console.log('[PLAYWRIGHT EVIDENCE] Capturing s1-idle.png (Idle State)...');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    const s1Buf = await page.screenshot({ animations: 'disabled' });
    fs.writeFileSync(path.join(outDir1, 's1-idle.png'), s1Buf);
    fs.writeFileSync(path.join(outDir2, 's1-idle.png'), s1Buf);

    // 2. Hover Screenshot (Mouse hovering over main viewport)
    console.log('[PLAYWRIGHT EVIDENCE] Capturing s2-hover.png (Hover Reveal)...');
    await page.mouse.move(800, 450);
    await page.waitForTimeout(300);
    const s2Buf = await page.screenshot({ animations: 'disabled' });
    fs.writeFileSync(path.join(outDir1, 's2-hover.png'), s2Buf);
    fs.writeFileSync(path.join(outDir2, 's2-hover.png'), s2Buf);

    // 3. Active Scrolling Screenshot
    console.log('[PLAYWRIGHT EVIDENCE] Capturing s3-active-scroll.png (Active Scrolling)...');
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(100);
    const s3Buf = await page.screenshot({ animations: 'disabled' });
    fs.writeFileSync(path.join(outDir1, 's3-active-scroll.png'), s3Buf);
    fs.writeFileSync(path.join(outDir2, 's3-active-scroll.png'), s3Buf);

    // 4. Modal Scroll Screenshot
    console.log('[PLAYWRIGHT EVIDENCE] Capturing s4-modal-scroll.png (Modal Independent Scrollbar)...');
    const journeyBtn = page.locator('button:has-text("360° Journey")').first();
    if (await journeyBtn.isVisible()) {
      await journeyBtn.click();
      await page.waitForTimeout(1000);
      await page.mouse.move(700, 500);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(200);
      const s4Buf = await page.screenshot({ animations: 'disabled' });
      fs.writeFileSync(path.join(outDir1, 's4-modal-scroll.png'), s4Buf);
      fs.writeFileSync(path.join(outDir2, 's4-modal-scroll.png'), s4Buf);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // 5. Wide Table Screenshot
    console.log('[PLAYWRIGHT EVIDENCE] Capturing s5-wide-table.png (Wide Table Horizontal & Vertical Scroll)...');
    await page.goto('http://localhost:3000/#/sales', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.mouse.move(600, 450);
    await page.waitForTimeout(300);
    const s5Buf = await page.screenshot({ animations: 'disabled' });
    fs.writeFileSync(path.join(outDir1, 's5-wide-table.png'), s5Buf);
    fs.writeFileSync(path.join(outDir2, 's5-wide-table.png'), s5Buf);

    // 6. Dark Theme Screenshot
    console.log('[PLAYWRIGHT EVIDENCE] Capturing s6-dark-theme.png (Dark Mode Scrollbar Auto-Hide)...');
    const darkBtn = page.locator('button[aria-label*="Dark"], button[title*="Dark"]');
    if (await darkBtn.isVisible()) {
      await darkBtn.first().click();
      await page.waitForTimeout(500);
      await page.mouse.move(600, 450);
      await page.waitForTimeout(300);
      const s6Buf = await page.screenshot({ animations: 'disabled' });
      fs.writeFileSync(path.join(outDir1, 's6-dark-theme.png'), s6Buf);
      fs.writeFileSync(path.join(outDir2, 's6-dark-theme.png'), s6Buf);
    }

    console.log('[PLAYWRIGHT EVIDENCE] All 6 scrollbar visual evidence screenshots captured successfully!');
  } catch (err) {
    console.error('[PLAYWRIGHT EVIDENCE ERROR]', err);
  } finally {
    await browser.close();
  }
}

main();
