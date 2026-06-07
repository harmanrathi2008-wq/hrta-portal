const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
    env[key] = val;
  }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  try {
    const { data: questions, error } = await supabase
      .from('questions')
      .select('id, question_type, options, correct_answer')
      .eq('question_type', 'subjective')
      .limit(3);
    
    if (error) throw error;
    
    questions.forEach((q, idx) => {
      console.log(`--- Question ${idx + 1} ---`);
      console.log(`ID: ${q.id}`);
      console.log(`Type: ${q.question_type}`);
      console.log(`Options Length: ${q.options ? q.options.length : 0}`);
      if (q.options) {
        q.options.forEach((opt, i) => {
          console.log(`  Option ${i}: ${opt.substring(0, 100)}...`);
        });
      }
      console.log(`Correct Answer: ${q.correct_answer}`);
    });
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
