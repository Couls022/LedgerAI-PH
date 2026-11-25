const { JSDOM } = require('jsdom');
const fs = require('fs');
const http = require('http');

http.get('http://localhost:3000', (res) => {
  let html = '';
  res.on('data', chunk => html += chunk);
  res.on('end', () => {
    const dom = new JSDOM(html, {
      url: 'http://localhost:3000/',
      runScripts: 'dangerously',
      resources: 'usable',
    });
    
    dom.window.console.error = (...args) => console.log('JSDOM_ERROR:', ...args);
    dom.window.console.warn = (...args) => console.log('JSDOM_WARN:', ...args);
    dom.window.addEventListener('error', event => {
      console.log('JSDOM_GLOBAL_ERROR:', event.error);
    });
    
    setTimeout(() => {
      console.log('JSDOM test completed');
      process.exit(0);
    }, 3000);
  });
});
