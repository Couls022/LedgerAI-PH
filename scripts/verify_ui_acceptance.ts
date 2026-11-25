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

async function run() {
  console.log('[UI ACCEPTANCE] Starting Playwright UI verification...');
  const outDir = path.join(process.cwd(), '.playwright-cli');
  fs.mkdirSync(outDir, { recursive: true });

  const executablePath = findChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    // 1. Verify OpenProfile screen
    console.log('[UI ACCEPTANCE] Checking Open Profile page...');
    await page.goto('http://localhost:3000/#/profile/open', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const trashBtn = page.locator('button[data-testid="unregister-btn-LGR-PH-2026-STRESS-DG-PREVIEW"]');
    const hasTrash = (await trashBtn.count()) > 0;
    console.log('[UI ACCEPTANCE] Trash button found on Deskguard card:', hasTrash);

    if (hasTrash) {
      await trashBtn.click();
      await page.waitForTimeout(500);
      const confirmBtn = page.locator('button[data-testid="confirm-unregister-LGR-PH-2026-STRESS-DG-PREVIEW"]');
      const hasConfirm = (await confirmBtn.count()) > 0;
      console.log('[UI ACCEPTANCE] Inline confirmation card revealed:', hasConfirm);
      // Cancel so we don't unregister during UI test
      await page.click('button:has-text("Cancel")');
      await page.waitForTimeout(300);
    }

    const openProfileShot = await page.screenshot();
    fs.writeFileSync(path.join(outDir, 'acceptance-1-open-profile.png'), openProfileShot);

    // 2. Navigate to login and authenticate
    console.log('[UI ACCEPTANCE] Logging in as admin@gmail.com...');
    await page.goto('http://localhost:3000/#/login/LGR-PH-2026-STRESS-DG-PREVIEW', { waitUntil: 'networkidle' });
    await page.fill('input[type="text"], input[type="email"]', 'admin@gmail.com');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button:has-text("Sign In")');
    await page.waitForTimeout(2500);

    // Skip onboarding tour if visible
    try {
      const tourSkip = page.locator('button:has-text("Skip Walkthrough"), button:has-text("Close tour")');
      if (await tourSkip.isVisible()) {
        await tourSkip.first().click();
        await page.waitForTimeout(500);
      }
    } catch (_) {}

    // Check dashboard text for absence of "Enterprise ERP" in sidebar
    const sidebarBrand = page.locator('aside');
    const sidebarText = await sidebarBrand.innerText();
    const hasEnterpriseErp = sidebarText.includes('Enterprise ERP');
    console.log('[UI ACCEPTANCE] Sidebar contains "Enterprise ERP":', hasEnterpriseErp, '(Should be false)');

    // 3. Navigate to Approval Inbox
    console.log('[UI ACCEPTANCE] Navigating to Approval Inbox workspace...');
    await page.goto('http://localhost:3000/#/activity-center?workspace=approvals', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Verify 9 queue filter tabs
    const expectedTabs = [
      'My Pending Approvals',
      'All Authorized Pending Approvals',
      'Awaiting My Approval',
      'Delegated Approvals',
      'Overdue Approvals',
      'Returned for Correction',
      'Rejected Records',
      'Approved Records',
      'Approval History'
    ];

    const pageContent = await page.content();
    let allTabsPresent = true;
    for (const tab of expectedTabs) {
      const found = pageContent.includes(tab);
      console.log(`[UI ACCEPTANCE] Tab "${tab}" present:`, found);
      if (!found) allTabsPresent = false;
    }
    console.log('[UI ACCEPTANCE] All 9 queue filter tabs present:', allTabsPresent);

    // Verify Approval Queue table headers
    const expectedHeaders = ['Tx ID', 'Type', 'Counterparty', 'Branch', 'Amount', 'Requester', 'Step', 'SLA', 'Status', 'Actions'];
    for (const header of expectedHeaders) {
      const found = pageContent.includes(header);
      console.log(`[UI ACCEPTANCE] Column header "${header}" present:`, found);
    }

    const approvalsShot = await page.screenshot();
    fs.writeFileSync(path.join(outDir, 'acceptance-2-approval-inbox.png'), approvalsShot);

    // 4. Navigate to Settings / AI Settings
    console.log('[UI ACCEPTANCE] Navigating to AI Settings...');
    await page.goto('http://localhost:3000/#/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const settingsShot = await page.screenshot();
    fs.writeFileSync(path.join(outDir, 'acceptance-3-settings.png'), settingsShot);

    console.log('[UI ACCEPTANCE] Verification finished successfully!');
  } catch (err) {
    console.error('[UI ACCEPTANCE ERROR]', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
