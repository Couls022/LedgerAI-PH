const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--disable-gpu', '--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => console.log('CONSOLE:', msg.text()));
  page.on('pageerror', error => console.log('PAGE_ERROR:', error.message));
  page.on('response', r => { if(!r.ok()) console.log('RESP_ERR', r.url(), r.status())});
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  console.log("URL after navigation:", page.url());
  console.log("HTML:", await page.content());
  await browser.close();
})();
