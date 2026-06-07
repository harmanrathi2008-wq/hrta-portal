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
    const url = `${supabaseUrl}/rest/v1/exams?select=id,title,subject`;
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

    const exams = await res.json();
    console.log(`Found ${exams.length} exams:`);
    for (const exam of exams) {
      // Count questions of each type for this exam
      const qUrl = `${supabaseUrl}/rest/v1/questions?exam_id=eq.${exam.id}&select=id,question_type,correct_answer`;
      const qRes = await fetch(qUrl, {
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (qRes.ok) {
        const qs = await qRes.json();
        const types = {};
        let nullCorrect = 0;
        qs.forEach(q => {
          types[q.question_type] = (types[q.question_type] || 0) + 1;
          if (q.correct_answer === null || q.correct_answer === undefined || q.correct_answer === '') {
            nullCorrect++;
          }
        });
        console.log(`- Exam ID: ${exam.id} | Title: "${exam.title}" | Subject: "${exam.subject}"`);
        console.log(`  Total questions: ${qs.length} | Types:`, types, `| Null Correct Answer Count: ${nullCorrect}`);
      }
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
