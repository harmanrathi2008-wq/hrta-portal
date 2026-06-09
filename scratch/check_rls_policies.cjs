const { createClient } = require('@supabase/supabase-js');
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
const supabaseServiceKey = env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  try {
    console.log("Cleaning up database test records...");
    const { error: delAdminErr } = await supabase.from('admins').delete().eq('email', 'attacker_test@test.com');
    if (delAdminErr) console.error("Failed to delete test admin:", delAdminErr.message);
    else console.log("Deleted test admin attacker_test@test.com");

    const { error: delResultErr } = await supabase.from('exam_results').delete().eq('status', 'published').eq('total_score', 100);
    if (delResultErr) console.error("Failed to delete test results:", delResultErr.message);
    else console.log("Deleted test exam results");
  } catch (err) {
    console.error("Cleanup error:", err.message);
  }
}

run();
