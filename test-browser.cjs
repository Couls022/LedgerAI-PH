const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--disable-gpu', '--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER_CONSOLE:', msg.text()));
  page.on('pageerror', error => console.log('BROWSER_PAGE_ERROR:', error.message));
  page.on('requestfailed', request => console.log('BROWSER_REQUEST_FAILED:', request.url(), request.failure().errorText));
  page.on('response', response => {
    if (!response.ok()) console.log('BROWSER_RESPONSE_FAILED:', response.url(), response.status());
  });
  await page.goto('http://localhost:3000/launcher', { waitUntil: 'networkidle' });
  await browser.close();
})();
