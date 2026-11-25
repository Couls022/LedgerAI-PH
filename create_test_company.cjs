const http = require('http');

const data = JSON.stringify({
  company: {
    legalName: "Test Company Inc",
    tradeName: "Test Company",
    tin: "123-456-789-000",
    industry: "COR",
    branchCode: "00",
  },
  admin: {
    email: "cpenaflor@ledgerai.ph",
    displayName: "Charlie",
    password: "@dM1n2025Couls"
  },
  locationPath: ""
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/companies/create-profile',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log(res.statusCode, body));
});

req.on('error', e => console.error(e));
req.write(data);
req.end();
