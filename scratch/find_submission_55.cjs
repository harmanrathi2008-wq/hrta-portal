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
    // Fetch all submissions
    const url = `${supabaseUrl}/rest/v1/exam_results?select=*`;
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

    const submissions = await res.json();
    console.log(`Found ${submissions.length} submissions.`);
    
    for (const sub of submissions) {
      const answers = sub.answers || {};
      // Check if any answer has value 55 or "55"
      const has55 = Object.values(answers).some(val => String(val) === '55');
      if (has55) {
        console.log(`\nSubmission ID: ${sub.id} | Student ID: ${sub.student_id} | Exam ID: ${sub.exam_id}`);
        console.log("Answers:", answers);
        
        // Fetch questions for this exam
        const qUrl = `${supabaseUrl}/rest/v1/questions?exam_id=eq.${sub.exam_id}&order=order_index.asc`;
        const qRes = await fetch(qUrl, {
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json'
          }
        });
        if (qRes.ok) {
          const qs = await qRes.json();
          qs.forEach((q, idx) => {
            const ans = answers[q.id];
            if (ans !== undefined) {
              console.log(`Q#${idx + 1} (Type: ${q.question_type}) | Ans: ${ans} | Correct: ${q.correct_answer}`);
            }
          });
        }
      }
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
