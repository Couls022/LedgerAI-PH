const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--disable-gpu', '--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => console.log('CONSOLE:', msg.text()));
  page.on('pageerror', error => console.log('PAGE_ERROR:', error.message));
  page.on('response', r => { if(!r.ok()) console.log('RESP_ERR', r.url(), r.status())});
  
  // Set the cookie so it bypasses the auth flow
  await page.context().addCookies([{
    name: '__SECURE-aistudio_auth_flow_may_set_cookies',
    value: 'true',
    domain: 'ais-dev-myazz5iciq5cwdiwqp6e5c-343881880269.asia-southeast1.run.app',
    path: '/',
    secure: true,
    sameSite: 'None'
  }]);

  await page.goto('https://ais-dev-myazz5iciq5cwdiwqp6e5c-343881880269.asia-southeast1.run.app/', { waitUntil: 'networkidle' });
  console.log("HTML:", await page.content());
  await browser.close();
})();
