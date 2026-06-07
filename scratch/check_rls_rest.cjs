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
    const url = `${supabaseUrl}/rest/v1/rpc`; // wait, is there an rpc?
    // Let's try to query pg_policies using an RPC if it exists, or just query a custom table if we can
    // Wait, let's query the supabase REST endpoint to see if pg_policies is exposed:
    const urlPolicies = `${supabaseUrl}/rest/v1/pg_policies`;
    const res = await fetch(urlPolicies, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`
      }
    });
    console.log("pg_policies status:", res.status);
    if (res.ok) {
      const data = await res.json();
      console.log("pg_policies:", data.filter(p => p.tablename === 'questions'));
    } else {
      console.log("Could not query pg_policies directly. Text:", await res.text());
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
