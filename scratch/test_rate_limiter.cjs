const express = require('express');
const { authLimiter } = require('../middleware/rateLimiters.js');
const http = require('http');

async function runTest() {
  const app = express();
  const PORT = 3009;

  // Apply rate limiter to a mock test route
  app.get('/test-auth', authLimiter, (req, res) => {
    res.status(200).json({ success: true });
  });

  const server = app.listen(PORT, async () => {
    console.log(`Mock server running on port ${PORT}...`);
    console.log('Sending 10 rapid requests to test rate limiting...');

    let successCount = 0;
    let blockedCount = 0;
    let blockedMessage = '';

    for (let i = 1; i <= 10; i++) {
      await new Promise((resolve) => {
        http.get(`http://localhost:${PORT}/test-auth`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            const status = res.statusCode;
            console.log(`Request #${i}: Status = ${status}`);
            if (status === 200) {
              successCount++;
            } else if (status === 429) {
              blockedCount++;
              try {
                blockedMessage = JSON.parse(data).error;
              } catch (e) {}
            }
            resolve();
          });
        }).on('error', (err) => {
          console.error(`Request #${i} failed:`, err.message);
          resolve();
        });
      });
    }

    console.log('\n--- Test Results ---');
    console.log(`Successful requests (expected 5): ${successCount}`);
    console.log(`Blocked requests (expected 5): ${blockedCount}`);
    console.log(`Block Message: "${blockedMessage}"`);

    server.close(() => {
      console.log('Mock server stopped.');
      if (successCount === 5 && blockedCount === 5) {
        console.log('✅ PASS: Rate limiter successfully blocked rapid requests after 5 attempts!');
        process.exit(0);
      } else {
        console.log('❌ FAIL: Rate limiter behavior was incorrect.');
        process.exit(1);
      }
    });
  });
}

runTest();
