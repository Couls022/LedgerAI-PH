import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000';

async function runE2eTest() {
  console.log("=== STARTING END-TO-END VERIFICATION TEST ===");

  const timestamp = Date.now();
  const testEmail = `testadmin_${timestamp}@ledgerai.ph`;
  const testPassword = `SecurePass_${timestamp}!`;
  const testLegalName = `E2E Test Enterprise ${timestamp}`;

  // Step 1: Create New Company Profile with explicit admin credentials
  console.log("Step 1: Creating new company profile with explicit administrator credentials...");
  const createRes = await fetch(`${BASE_URL}/api/companies/create-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company: {
        legalName: testLegalName,
        tradeName: `E2E Trade ${timestamp}`,
        tin: "987-654-321-000",
        branchCode: "00",
        industry: "Services"
      },
      tax: {
        taxpayerClassification: "CORPORATION",
        vatStatus: "VAT",
        rdoCode: "039"
      },
      accounting: {
        fiscalYear: 2026,
        fiscalYearStartMonth: 1
      },
      admin: {
        email: testEmail,
        password: testPassword,
        displayName: "E2E Administrator"
      }
    })
  });

  const createData: any = await createRes.json();
  console.log(`Create Company Response Status: ${createRes.status}`);
  if (!createRes.ok || !createData.companyId) {
    throw new Error(`Company creation failed: ${JSON.stringify(createData)}`);
  }
  const companyId = createData.companyId;
  console.log(`-> Company Created Successfully! Company ID: ${companyId}`);

  // Step 2: Test Login with created company profile and explicit password
  console.log("\nStep 2: Testing login with newly created administrator credentials...");
  const loginRes1 = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail.toUpperCase(), // Test case-insensitivity
      password: testPassword,
      companyId
    })
  });

  const loginData1: any = await loginRes1.json();
  console.log(`Login Response Status: ${loginRes1.status}`);
  if (!loginRes1.ok || !loginData1.token) {
    throw new Error(`Login failed: ${JSON.stringify(loginData1)}`);
  }
  const token1 = loginData1.token;
  console.log(`-> Token received: ${token1}`);
  console.log(`-> First Login Successful! Role: ${loginData1.activeCompany.roleName || loginData1.activeCompany.role}`);

  // Step 3: Test Session Hydration & Dashboard Access
  console.log("\nStep 3: Testing session hydration and dashboard API access...");
  const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, {
    headers: {
      'Authorization': `Bearer ${token1}`,
      'Cookie': `token=${token1}`,
      'Accept': 'application/json'
    }
  });

  const sessionData: any = await sessionRes.json();
  console.log(`Session Response Status: ${sessionRes.status}`);
  if (!sessionRes.ok || !sessionData.user) {
    throw new Error(`Session hydration failed: ${JSON.stringify(sessionData)}`);
  }
  console.log(`-> Session Hydrated! User: ${sessionData.user.displayName}, Permissions Count: ${sessionData.permissions.length}`);

  const dashboardRes = await fetch(`${BASE_URL}/api/companies/current/details`, {
    headers: {
      'Authorization': `Bearer ${token1}`,
      'Cookie': `token=${token1}`
    }
  });
  const dashboardData: any = await dashboardRes.json();
  console.log(`Company Details Response Status: ${dashboardRes.status}`);
  if (!dashboardRes.ok) {
    throw new Error(`Company details access failed: ${JSON.stringify(dashboardData)}`);
  }
  console.log(`-> Company Details Accessed Successfully! Legal Name: ${dashboardData.legalName || 'N/A'}`);

  // Step 4: Logout
  console.log("\nStep 4: Executing logout...");
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token1}` }
  });
  console.log(`Logout Response Status: ${logoutRes.status}`);

  // Step 5: Second Login (Re-authentication Verification)
  console.log("\nStep 5: Re-logging in to verify multi-session stability...");
  const loginRes2 = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail.toLowerCase(),
      password: testPassword,
      companyId
    })
  });

  const loginData2: any = await loginRes2.json();
  console.log(`Second Login Response Status: ${loginRes2.status}`);
  if (!loginRes2.ok || !loginData2.token) {
    throw new Error(`Second login failed: ${JSON.stringify(loginData2)}`);
  }
  console.log("-> Re-authentication Successful!");

  // Step 6: Verify Existing Companies List remains intact
  console.log("\nStep 6: Verifying existing companies list integrity...");
  const listRes = await fetch(`${BASE_URL}/api/companies`);
  const listData: any = await listRes.json();
  console.log(`List Companies Status: ${listRes.status}, Total Companies: ${listData.length}`);
  const createdExists = listData.some((c: any) => c.id === companyId);
  if (!createdExists) {
    throw new Error("Created company was not found in company manifest registry list!");
  }
  console.log("-> Company List Integrity Verified!");

  console.log("\n=== ALL E2E VERIFICATION STEPS PASSED SUCCESSFULLY ===");
}

runE2eTest().catch(err => {
  console.error("E2E Test Failure:", err);
  process.exit(1);
});
