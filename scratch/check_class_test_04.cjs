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
    const examId = '9d6e72fa-4540-445c-bc7b-be395e20aa3d';
    const url = `${supabaseUrl}/rest/v1/questions?exam_id=eq.${examId}&order=order_index.asc`;
    const res = await fetch(url, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      }
    });

    const questions = await res.json();
    console.log(`Exam ${examId} has ${questions.length} questions.`);
    questions.forEach((q, idx) => {
      const isNumerical = q.question_type === 'numerical_integer' || q.question_type === 'numerical_decimal';
      if (isNumerical) {
        console.log(`Q#${idx + 1} | Type: ${q.question_type} | Text: "${q.question_text}" | Correct: "${q.correct_answer}"`);
      }
    });
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
