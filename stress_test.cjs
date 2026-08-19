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
        'Cookie': authCookie || '',
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
  const companyId = 'LGR-PH-2026-COR-00-59CEAD34';
  console.log(`[1] Starting login for company ${companyId}...`);
  const loginRes = await request('POST', '/api/auth/login', {
    email: 'cpenaflor@ledgerai.ph',
    password: '@dM1n2025Couls',
    companyId: companyId
  });
  
  if (loginRes.status !== 200) {
    console.error("Login failed!", loginRes.status, loginRes.body);
    return;
  }
  
  console.log("[1] Login successful.");
  const tokenData = JSON.parse(loginRes.body);
  const cookies = `token=${tokenData.token}; activeCompanyId=${companyId}`;

  console.log("[2] Running parallel API stress test requests...");
  const promises = [];
  
  // 60 concurrent requests to various valid endpoints
  for (let i = 0; i < 20; i++) {
    promises.push(request('GET', '/api/companies/current/details', null, cookies));
    promises.push(request('GET', '/api/accounting/accounts', null, cookies));
    promises.push(request('GET', '/api/audit', null, cookies));
  }
  
  const start = Date.now();
  const results = await Promise.all(promises);
  const duration = Date.now() - start;
  
  const successful = results.filter(r => r.status === 200).length;
  console.log(`[3] Stress test complete in ${duration}ms.`);
  console.log(`[3] Total Requests: ${results.length}, Successful: ${successful}, Failed: ${results.length - successful}`);
  
  if (successful === results.length) {
    console.log("System passed stress test perfectly. Database bindings and API routes are handling concurrent loads gracefully.");
  } else {
    console.log("Some requests failed. Sample failed response:", results.find(r => r.status !== 200));
  }
})();
