const { chromium } = require('playwright');
const path = require('path');

(async () => {
  try {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    console.log('Navigating to /#/login/LGR-PH-2026-BPC-02...');
    await page.goto('http://127.0.0.1:3000/#/login/LGR-PH-2026-BPC-02', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    const passInput = await page.$('input[type="password"], input[name="password"], input[placeholder*="password" i]');
    if (emailInput && passInput) {
      await emailInput.fill('owner@bayanihanprime.ph');
      await passInput.fill('Bayanihan!2026');
      const submitBtn = await page.$('button[type="submit"], button:has-text("Sign In"), button:has-text("Sign in")');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForTimeout(4000);
      }
    }

    const skipBtn = await page.$('button:has-text("Skip Walkthrough"), button:has-text("Skip")');
    if (skipBtn) {
      await skipBtn.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: path.join(__dirname, 'public/dashboard_bayanihan_verified.png') });
    console.log('Saved dashboard_bayanihan_verified.png');

    console.log('Navigating to /#/tax...');
    await page.goto('http://127.0.0.1:3000/#/tax', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const skipBtnTax = await page.$('button:has-text("Skip Walkthrough"), button:has-text("Skip")');
    if (skipBtnTax) {
      await skipBtnTax.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: path.join(__dirname, 'public/tax_bayanihan_verified.png') });
    console.log('Saved tax_bayanihan_verified.png');

    await browser.close();
    console.log('Bayanihan visual verification completed!');
  } catch (err) {
    console.error('Screenshot error:', err.message);
  }
})();
