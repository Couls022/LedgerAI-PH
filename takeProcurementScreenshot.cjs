const { chromium } = require('playwright');
const path = require('path');

(async () => {
  try {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

    // Log in to Pacific Crest
    console.log('Navigating to login...');
    await page.goto('http://127.0.0.1:3000/#/login/LGR-PH-2026-PCT-01', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    const passInput = await page.$('input[type="password"], input[name="password"], input[placeholder*="password" i]');
    if (emailInput && passInput) {
      await emailInput.fill('owner@pacificcrest.ph');
      await passInput.fill('LedgerPH!2026');
      const submitBtn = await page.$('button[type="submit"], button:has-text("Sign In"), button:has-text("Sign in")');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForTimeout(3000);
      }
    }

    // Dismiss tour
    const skipBtn = await page.$('button:has-text("Skip Walkthrough"), button:has-text("Skip")');
    if (skipBtn) {
      await skipBtn.click();
      await page.waitForTimeout(1000);
    }

    // Navigate to Procurement & 3-Way Match
    console.log('Navigating to /#/accounting/procurement...');
    await page.goto('http://127.0.0.1:3000/#/accounting/procurement', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    const skipBtn2 = await page.$('button:has-text("Skip Walkthrough"), button:has-text("Skip")');
    if (skipBtn2) {
      await skipBtn2.click();
      await page.waitForTimeout(1000);
    }

    // Scroll down to Purchase Orders Register table
    await page.evaluate(() => {
      const el = document.querySelector('table');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForTimeout(1000);

    // Click on "Matched & Billed" tab to show the exact row from user screenshot
    console.log('Clicking Matched & Billed tab...');
    const matchedTab = await page.$('button:has-text("Matched & Billed")');
    if (matchedTab) {
      await matchedTab.click();
      await page.waitForTimeout(1000);
    }

    const outPath = path.join(__dirname, 'public/procurement_matched_without_bill360.png');
    await page.screenshot({ path: outPath });
    console.log('Saved screenshot to:', outPath);

    await browser.close();
  } catch (err) {
    console.error('Screenshot error:', err.message);
  }
})();
