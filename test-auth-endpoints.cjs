const http = require('http');
const db = require('better-sqlite3')('data/companies/LGR-PH-2026-TEST-00-ABC12345/.db_active.sqlite');
const user = db.prepare("SELECT * FROM users LIMIT 1").get();
const comp = require('./data/registry.json')[0];
const data = JSON.stringify({ email: user.email, password: "Password123!", companyId: comp.id });
console.log("Using credentials", data);

const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    let token = "";
    try { token = JSON.parse(body).token; } catch(e){}
    if(!token) {
        console.log("Failed to login", body);
        return;
    }
    console.log("Login success! Token:", token.substring(0, 20) + "...");
  });
});
req.write(data);
req.end();
