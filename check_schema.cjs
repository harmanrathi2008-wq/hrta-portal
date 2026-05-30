const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
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
    const { data, error } = await supabase.from('exam_results').select('*').limit(1);
    if (error) throw error;
    if (data && data.length > 0) {
      console.log("Exam Result Sample:", JSON.stringify(data[0], null, 2));
    } else {
      console.log("No exam results found.");
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
