async page => {
  await page.context().addCookies([
    { name: 'token', value: 'LGR-PH-2026-STRESS-DG-PREVIEW.sess-pw-verify-2026', domain: 'localhost', path: '/' }
  ]);
  await page.evaluate(() => {
    localStorage.setItem('ledger_onboarding_completed', 'true');
    localStorage.setItem('ledgerai_token', 'LGR-PH-2026-STRESS-DG-PREVIEW.sess-pw-verify-2026');
    localStorage.setItem('token', 'LGR-PH-2026-STRESS-DG-PREVIEW.sess-pw-verify-2026');
    window.location.hash = '#/dashboard';
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // Click floating Ledger Agent button
  const agentToggle = page.locator('button:has(svg.lucide-bot)').last();
  await agentToggle.click();
  await page.waitForTimeout(1500);

  // Click Quick Prompt: "Magkano kinita ko this month?"
  const quickPrompt = page.locator('button:has-text("Magkano kinita ko this month?")').first();
  await quickPrompt.click();
  await page.waitForTimeout(4000);

  const drawerText = await page.locator('body').innerText();
  return {
    hasRevenueAnswer: drawerText.includes('Net Income') || drawerText.includes('Gross Revenue') || drawerText.includes('₱'),
    hasProvenance: drawerText.includes('LOCAL_OFFLINE_ENGINE') || drawerText.includes('Offline Rule Engine') || drawerText.includes('Core Engine'),
    hasSourceRecords: drawerText.includes('View 360° Source') || drawerText.includes('gl_accounts') || drawerText.includes('journals')
  };
}
