const fs = require('fs');
const path = require('path');

// Manually parse .env file
const envPath = path.join(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let key = match[1];
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.substring(1, value.length - 1);
    }
    env[key] = value.trim();
  }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

async function run() {
  try {
    const url = `${supabaseUrl}/rest/v1/questions?question_text=ilike.%25vertically%20upwards%25`;
    const res = await fetch(url, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const questions = await res.json();
    console.log("Matching questions found:", questions.length);
    questions.forEach((q, idx) => {
      console.log(`\n[${idx + 1}] ID: ${q.id}`);
      console.log(`Type: ${q.question_type || q.type}`);
      console.log(`Content: ${q.question_text}`);
      console.log(`Correct Answer: "${q.correct_answer}"`);
      console.log(`Options:`, q.options);
    });
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
