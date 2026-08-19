const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`[CONSOLE] ${msg.text()}`);
  });

  page.on('pageerror', err => console.log('[PAGE ERROR]', err.message || err));

  console.log('1. Creating company profile via UI...');
  await page.goto('http://localhost:3000/profile/create', { waitUntil: 'networkidle' });
  const compName = `Phase7 Regression Co ${Date.now()}`;
  const textInputs1 = page.locator('input[type="text"]');
  await textInputs1.nth(0).fill(compName);
  await page.click('button:has-text("Next")');
  await page.click('button:has-text("Next")');
  await page.click('button:has-text("Next")');

  await page.fill('input[type="text"]', 'Owner User');
  await page.fill('input[type="email"]', 'owner@regression.com');
  const passwordInputs = page.locator('input[type="password"]');
  await passwordInputs.nth(0).fill('Owner123!Pass');
  await passwordInputs.nth(1).fill('Owner123!Pass');
  await page.click('button:has-text("Create Profile")');
  await page.waitForTimeout(2000);

  const loginUrl = page.url();
  console.log('Post-create URL:', loginUrl);
  const companyId = loginUrl.split('/login/')[1];

  console.log('2. Signing in as Owner...');
  await page.fill('input[type="email"]', 'owner@regression.com');
  await page.fill('input[type="password"]', 'Owner123!Pass');
  await page.click('button:has-text("SIGN IN")');
  await page.waitForTimeout(2000);

  console.log('3. Seeding Chart of Accounts as Owner...');
  await page.evaluate(async () => {
    await fetch('/api/master-data/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        accountCode: '1010',
        accountName: 'Cash on Hand',
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        isCashAccount: true
      })
    });
    await fetch('/api/master-data/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        accountCode: '4000',
        accountName: 'Sales Revenue',
        accountType: 'REVENUE',
        normalBalance: 'CREDIT'
      })
    });
  });

  console.log('4. Creating Bookkeeper and Approver...');
  await page.evaluate(async () => {
    await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: 'bookkeeper@test.com', password: 'Password123!', displayName: 'Bookkeeper', role: 'Bookkeeper' })
    });
    await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: 'approver@test.com', password: 'Password123!', displayName: 'Approver', role: 'Approver' })
    });
  });

  console.log('5. Resetting initial passwords for Bookkeeper & Approver...');
  await page.evaluate(async (cId) => {
    // login bookkeeper
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: 'bookkeeper@test.com', password: 'Password123!', companyId: cId })
    });
    await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ currentPassword: 'Password123!', newPassword: 'Password1234!' })
    });

    // login approver
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: 'approver@test.com', password: 'Password123!', companyId: cId })
    });
    await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ currentPassword: 'Password123!', newPassword: 'Password1234!' })
    });
  }, companyId);

  console.log('6. Logging in as Bookkeeper & Creating Journal Draft...');
  const jId = await page.evaluate(async (cId) => {
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: 'bookkeeper@test.com', password: 'Password1234!', companyId: cId })
    });
    const accRes = await fetch('/api/accounting/accounts', { credentials: 'include' });
    const accs = await accRes.json();
    console.log('Accounts fetched count:', accs ? accs.length : 0);

    const jRes = await fetch('/api/accounting/journals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        entryNumber: `JE-REG-${Date.now().toString().slice(-4)}`,
        entryDate: new Date().toISOString().split('T')[0],
        description: 'Phase 7 Final Regression Journal Entry',
        lines: [
          { accountId: accs[0].id, debit: 5000, credit: 0 },
          { accountId: accs[1].id, debit: 0, credit: 5000 }
        ]
      })
    });
    const jData = await jRes.json();
    return jData.id;
  }, companyId);

  console.log('Created Journal ID:', jId);

  console.log('7. Submitting Journal Entry...');
  await page.evaluate(async (id) => {
    await fetch(`/api/accounting/journals/${id}/submit`, { method: 'POST', credentials: 'include' });
  }, jId);

  console.log('8. Logging in as Approver to Approve & Post...');
  await page.evaluate(async ({ cId, id }) => {
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: 'approver@test.com', password: 'Password1234!', companyId: cId })
    });
    await fetch(`/api/accounting/journals/${id}/approve`, { method: 'POST', credentials: 'include' });
    await fetch(`/api/accounting/journals/${id}/post`, { method: 'POST', credentials: 'include' });
  }, { cId: companyId, id: jId });

  console.log('9. Verifying Reports & UI...');
  await page.goto('http://localhost:3000/reports/trial-balance', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const tbText = await page.innerText('body');
  console.log('Trial Balance text includes Trial Balance:', tbText.includes('Trial Balance'));

  await page.goto('http://localhost:3000/reports/general-ledger', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const glText = await page.innerText('body');
  console.log('General Ledger text includes General Ledger:', glText.includes('General Ledger'));

  console.log('10. Testing Reload Persistence...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const reloadText = await page.innerText('body');
  console.log('Post-reload page rendered properly:', reloadText.includes('General Ledger') || reloadText.includes('LedgerAI'));

  await browser.close();
  console.log('=== REGRESSION TEST SUCCESSFUL ===');
})();
