const { chromium } = require('playwright');
const path = require('path');

(async () => {
  try {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // 1. Open Existing Profile Screen
    console.log('Navigating to /#/profile/open...');
    await page.goto('http://127.0.0.1:3000/#/profile/open', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(__dirname, 'public/open_existing_verified.png') });
    console.log('Saved open_existing_verified.png');

    // 2. Server Landing Page
    console.log('Navigating to /#/launcher?switch=1&view=server...');
    await page.goto('http://127.0.0.1:3000/#/launcher?switch=1&view=server', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(__dirname, 'public/server_landing_verified.png') });
    console.log('Saved server_landing_verified.png');

    // 3. Client Landing Page
    console.log('Navigating to /#/launcher?switch=1&view=client...');
    await page.goto('http://127.0.0.1:3000/#/launcher?switch=1&view=client', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(__dirname, 'public/client_landing_verified.png') });
    console.log('Saved client_landing_verified.png');

    // 4. Log in to Pacific Crest Trading & Logistics Corp.
    console.log('Navigating to /#/login/LGR-PH-2026-PCT-01...');
    await page.goto('http://127.0.0.1:3000/#/login/LGR-PH-2026-PCT-01', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(__dirname, 'public/login_pacificcrest_verified.png') });
    console.log('Saved login_pacificcrest_verified.png');

    // Fill in credentials and submit
    const emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    const passInput = await page.$('input[type="password"], input[name="password"], input[placeholder*="password" i]');
    if (emailInput && passInput) {
      await emailInput.fill('owner@pacificcrest.ph');
      await passInput.fill('LedgerPH!2026');
      const submitBtn = await page.$('button[type="submit"], button:has-text("Sign In"), button:has-text("Sign in")');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForTimeout(4000);
      }
    }

    // Dismiss tour if present
    const skipBtn = await page.$('button:has-text("Skip Walkthrough"), button:has-text("Skip")');
    if (skipBtn) {
      await skipBtn.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: path.join(__dirname, 'public/dashboard_pacificcrest_verified.png') });
    console.log('Saved dashboard_pacificcrest_verified.png');

    // 5. Tax & BIR Compliance
    console.log('Navigating to /#/tax...');
    await page.goto('http://127.0.0.1:3000/#/tax', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const skipBtnTax = await page.$('button:has-text("Skip Walkthrough"), button:has-text("Skip")');
    if (skipBtnTax) {
      await skipBtnTax.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: path.join(__dirname, 'public/tax_pacificcrest_verified.png') });
    console.log('Saved tax_pacificcrest_verified.png');

    await browser.close();
    console.log('All 5 visual screenshots captured cleanly!');
  } catch (err) {
    console.error('Screenshot error:', err.message);
  }
})();
