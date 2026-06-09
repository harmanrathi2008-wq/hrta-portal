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
    console.log("Auditing Database RLS Status...");
    
    // We run a query using rpc or system catalogue views if possible.
    // If pg_catalog is blocked, we can try to query policy lists or make RPC calls.
    // Let's call supabase.rpc('execute_sql') if it exists, or check tables directly
    const { data: tablesData, error: tablesError } = await supabase
      .from('exams')
      .select('*')
      .limit(1);
      
    if (tablesError) {
      console.error("Failed to query exams table:", tablesError.message);
    } else {
      console.log("Successfully connected. Now querying RLS configuration...");
    }

    // Since we cannot run raw sql without exec_sql RPC, let's try calling pg_policies view through PostgREST
    // PostgREST sometimes exposes system views if the API schema allows it.
    const { data: policies, error: polErr } = await supabase
      .from('pg_policies')
      .select('*');

    if (polErr) {
      console.log("Exhaustive pg_policies API query failed: " + polErr.message);
      console.log("Trying to check table access permissions using anon key vs service role key to audit RLS presence...");
      await testAnonAccess();
    } else {
      console.log("Policies:", policies);
    }
  } catch (err) {
    console.error("Diagnostic error:", err.message);
  }
}

async function testAnonAccess() {
  const anonClient = createClient(supabaseUrl, env.VITE_SUPABASE_ANON_KEY);
  
  // Test 1: Try reading exams table anonymously
  const { data: anonData, error: anonErr } = await anonClient.from('exams').select('*').limit(1);
  console.log("Anon Read Exams status:", anonErr ? `Blocked (${anonErr.message})` : "Allowed (Warning: Publicly readable!)");
  
  // Test 2: Try writing to admins table anonymously
  const { data: adminData, error: adminErr } = await anonClient.from('admins').insert([{ email: 'attacker_test@test.com', role: 'super_admin' }]);
  console.log("Anon Insert Admin status:", adminErr ? `Blocked (${adminErr.message})` : "Allowed (CRITICAL SECURITY BREACH: Anyone can create admin accounts!)");

  // Test 3: Try writing to exam_results anonymously
  const { data: resultData, error: resultErr } = await anonClient.from('exam_results').insert([{ total_score: 100, status: 'published' }]);
  console.log("Anon Insert Exam Results status:", resultErr ? `Blocked (${resultErr.message})` : "Allowed (CRITICAL SECURITY BREACH: Anyone can submit results!)");
}

run();
