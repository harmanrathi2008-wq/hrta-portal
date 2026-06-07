const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function readLastUserMessages() {
  const logPath = 'C:\\Users\\Harman Rathi\\.gemini\\antigravity\\brain\\2d82983b-7d67-4d3b-b534-8b115d0a7aec\\.system_generated\\logs\\transcript.jsonl';
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const userMessages = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const step = JSON.parse(line);
      if (step.type === 'USER_INPUT') {
        userMessages.push({
          step_index: step.step_index,
          content: step.content
        });
      }
    } catch (e) {
      // ignore parsing error
    }
  }

  // Print the last 15 user messages
  console.log("Last 15 User Messages:");
  userMessages.slice(-15).forEach((msg, idx) => {
    console.log(`\n--- Message [Step ${msg.step_index}] ---`);
    console.log(msg.content);
  });
}

readLastUserMessages();
