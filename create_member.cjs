const http = require('http');

async function request(method, path, body, authCookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': authCookie,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: responseBody }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  // First, login as admin
  const loginRes = await request('POST', '/api/auth/login', {
    email: 'final_acceptance_2026@ledgerai.ph',
    password: 'LedgerAI_Secure_Password_2026!',
    companyId: 'LGR-PH-2026-SOF-00-539E0386'
  });
  
  // Extract cookie
  let cookies = '';
  try {
    const loginData = JSON.parse(loginRes.body);
    cookies = `token=${loginData.token}; activeCompanyId=LGR-PH-2026-SOF-00-539E0386`;
  } catch (e) {}

  // Or try to create user via HTTP POST
  const createRes = await request('POST', '/api/users', {
    email: 'juan@company.com',
    displayName: 'Juan',
    password: 'password123',
    role: 'Bookkeeper'
  }, cookies);
  
  console.log("Create user status:", createRes.status);
  console.log("Create user body:", createRes.body);
})();
