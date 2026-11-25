const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type().toUpperCase()}]`, msg.text());
  });

  page.on('pageerror', err => {
    console.log('[PAGE ERROR]', err.stack || err.message || err);
  });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  console.log('Current URL:', page.url());
  console.log('Title:', await page.title());
  
  const textContent = await page.innerText('body');
  console.log('Body Text Snippet:', textContent.substring(0, 500));

  await browser.close();
})();
