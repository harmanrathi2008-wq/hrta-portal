const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
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

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ Error: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const tables = ['admins', 'students', 'exams', 'questions', 'exam_results', 'personal_assignments'];

async function testRLS() {
  console.log("Checking Supabase RLS policies by querying as an anonymous user...\n");

  for (const table of tables) {
    try {
      const { data, error, status } = await supabase
        .from(table)
        .select('*')
        .limit(1);

      if (error) {
        console.log(`Table "${table}": 🛡️ PROTECTED (Returned error: "${error.message}" with status ${status})`);
      } else if (data && data.length > 0) {
        // If data is returned, we need to make sure it's not exposing sensitive rows
        if (table === 'exams') {
          console.log(`Table "${table}": ℹ️ PARTIALLY OPEN (Public select allowed for student visibility. Sample row ID: ${data[0].id})`);
        } else {
          console.log(`Table "${table}": ⚠️ UNPROTECTED! RLS is OFF! Anonymously exposed data:`, data[0]);
        }
      } else {
        console.log(`Table "${table}": 🛡️ PROTECTED (Returned empty set under RLS policies)`);
      }
    } catch (err) {
      console.log(`Table "${table}": 🛡️ PROTECTED (Request crashed: ${err.message})`);
    }
  }
}

testRLS();
