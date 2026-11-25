const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// THE PRIVATE KEY REMAINS HERE - NEVER DEPLOYED TO CUSTOMER
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCWaphyrDWPziMs
BTFmr5fLF7sitJtMwP1s+hyx0BN4LtzTp1Uol5J5WYknpN4ZNReso6Dhnx3Vu3+o
ScNDu2MrgGr/gNqrbxotSsSR+xq1zfji0osr5bAml7zubHTqzeHOSFU/SIs6U/M6
jYHdm6KxOYP/Ks1cuanlt8kAqphJGjPmAlBmO7L54cu5gOmLW54u6K+pg9NZaXEX
7jiNZkWZDVt+YZ7QJamCupPBwHHr2BJZrnk4L2I9DoVkDH1YN3vSE2Td95sOj4ra
Ini8QXH3+0GJALf9X+SVfhVxGb9KZjAEgPNgqBu4dBnkNPCVbVvTD1CaXLz15V/z
XGzqClE5AgMBAAECggEABtRX7+P3ChycTvY85hpMqHNfQy4DW56rGwi3pxCpI6Sw
ENmZBZ7tLv6UWkUTcv5MwQFMb5YViRPqccoImEGQuQPLh+aSNyS0IfCSQIUP00ei
+GyCFmgHQZdT5BjvTY5zxVWWLkmFTcyMP4E3j2fuwQB5KGupd59z8frQYOv9/lql
BOQXsJjKyT/z+7q08TXP2fUEQJTLHaiure0laRraWTUeHWR7VFq3h77Ff5hSO81+
ZQJoUnQ79I2O8CYXSnXn07LmYUsK4dnoI1iKISNECk6RKWTqGbctVZIeMTzCVHx+
emLRLJ4PhvFvUqok1XGSUOL2krK1cRdAv0tpDnXdIQKBgQDF5Wl4kJeBrcBqErdJ
WA5Qt4Nl5gvaVAvXSCQ+ReFFXXPQFpvQEbKm5FmiNgZk2A/mgwCZ1Q/kvU79MqCR
ZGbrl7lc1CnlscI3piYgQEX+ode3hJjCqTp2gdHoDKjI7Tu6OlB5FwdzwY+5JEU8
amjmffqAI7rAqyz958cpNCRS4QKBgQDClG8cR0qqGs1ylY3UTNTqopWhjRee/gF2
nXbc6PVEMXNtDnv7xkNxu5JLXUNn3O1wRCwg+i4iYHanElRB2exvRMC5yTivcjiC
8KZvB/HBrybM4OEBnACalogpMHBatdZbFkq2XYYaSlNC8RXONPDXlbtrX03zv7fe
tnkGxIqhWQKBgQCVYhKWxxcG9eDccVpYDBdqSMzwW5Iw8eaqULPDKj7dfKjSuG5P
xzxDjPY4Y226K/r8t4D5noLL2TdKHDBm8BJc3wA2mZUy5VdFaK85AyuTBhpvVrF1
qAcQs/h+oSe73JCMiD582axvbfqO+FknPPAIpao1lkL/83cYByEo8kpFIQKBgBBn
XRqgM/41Nj7Dtuo/8+83969f6q7fsRXj3oJvLUYreRSnlPI727G543JxEV6vNGEz
jhjVnpANW9Nn6yyGB7W1sR24hgvccEExsoZHwCzY7Ed3aeCt2ystJ5t5Vu9+xux0
66WGKukKfQx2sKTqt6clG2DI7xRuhDzFW1yjsyA5AoGAXOGHuXojnPxkW54MGXWI
Zeld90X4g1gNBBCL3YGCfTGMm3P+ZHnBEU9sMt5JfoZmu68zuzF9xhd10skj4hoZ
sYbfW9YuX9lH3HGdR+ulyPihc2QkRhJpdHIxjjcTFjR7Xy0DNI2MBFzQ1Eo+KKbe
NKaRFx4k26n5RR9oQBjFeGE=
-----END PRIVATE KEY-----`;

function generateLicense(payload) {
  const sign = crypto.createSign('SHA256');
  sign.update(JSON.stringify(payload));
  sign.end();
  const signature = sign.sign(PRIVATE_KEY, 'base64');
  
  return {
    payload,
    signature
  };
}

const args = process.argv.slice(2);
const command = args[0];

if (command === 'generate') {
  const companyId = args[1];
  const plan = args[2] || 'PRO';
  const expirationStr = args[3]; // Optional YYYY-MM-DD
  
  if (!companyId) {
    console.error('Usage: node index.js generate <companyId> [plan: PRO|ENTERPRISE] [expirationDate YYYY-MM-DD]');
    process.exit(1);
  }

  const activationKey = `ACT-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

  const payload = {
    licenseId: `LIC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    productId: 'LEDGERAI-PH',
    companyId,
    activationKey,
    planType: plan.toUpperCase(),
    status: 'ACTIVE',
    issuedAt: new Date().toISOString(),
    expirationDate: expirationStr ? new Date(expirationStr).toISOString() : null,
    type: expirationStr ? 'SUBSCRIPTION' : 'LIFETIME',
    entitlements: {
      users: plan.toUpperCase() === 'ENTERPRISE' ? -1 : 5,
      ocr: true,
      ai: true
    },
    schemaVersion: 1
  };

  const signedLicense = generateLicense(payload);
  const outPath = path.join(__dirname, `license_${companyId}.lai`);
  fs.writeFileSync(outPath, JSON.stringify(signedLicense, null, 2));
  console.log(`License generated and signed for ${companyId}`);
  console.log(`Activation Key: ${activationKey} (Provide this securely to the customer)`);
  console.log(`Saved to ${outPath}`);
} else if (command === 'verify') {
  // Test local verification with PUBLIC KEY just to be sure it matches
  const licenseFile = args[1];
  const content = fs.readFileSync(licenseFile, 'utf8');
  const parsed = JSON.parse(content);
  
  const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlmqYcqw1j84jLAUxZq+X
yxe7IrSbTMD9bPocsdATeC7c06dVKJeSeVmJJ6TeGTUXrKOg4Z8d1bt/qEnDQ7tj
K4Bq/4Daq28aLUrEkfsatc344tKLK+WwJpe87mx06s3hzkhVP0iLOlPzOo2B3Zui
sTmD/yrNXLmp5bfJAKqYSRoz5gJQZjuy+eHLuYDpi1ueLuivqYPTWWlxF+44jWZF
mQ1bfmGe0CWpgrqTwcBx69gSWa55OC9iPQ6FZAx9WDd70hNk3febDo+K2iJ4vEFx
9/tBiQC3/V/klX4VcRm/SmYwBIDzYKgbuHQZ5DTwlW1b0w9Qmly89eVf81xs6gpR
OQIDAQAB
-----END PUBLIC KEY-----`;

  const verify = crypto.createVerify('SHA256');
  verify.update(JSON.stringify(parsed.payload));
  verify.end();
  const isValid = verify.verify(PUBLIC_KEY, parsed.signature, 'base64');
  console.log(`Signature is ${isValid ? 'VALID' : 'INVALID'}`);
} else {
  console.log('Commands:\n  generate <companyId> [plan: PRO|ENTERPRISE] [expirationDate YYYY-MM-DD]\n  verify <license_file.lai>');
}
