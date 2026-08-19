const https = require('https');
const fs = require('fs');

const file = fs.createWriteStream("node.exe");
https.get("https://nodejs.org/dist/v20.11.1/win-x64/node.exe", function(response) {
  response.pipe(file);
});
