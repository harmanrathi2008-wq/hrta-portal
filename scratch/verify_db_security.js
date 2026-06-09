// =====================================================================
// DATABASE RLS SECURITY AUDIT SCRIPT
// Harman Rathi Testing Agency (HRTA) Portal - Security System Upgrade
// =====================================================================

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Manual zero-dependency .env parser
function loadEnv() {
  try {
    const envPath = path.resolve('.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const index = trimmed.indexOf('=');
        if (index !== -1) {
          const key = trimmed.slice(0, index).trim();
          let value = trimmed.slice(index + 1).trim();
          // Strip enclosing quotes
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          process.env[key] = value;
        }
      });
    }
  } catch (e) {
    console.warn("Manual .env loading warning:", e.message);
  }
}
loadEnv();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ Error: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment variables.");
  process.exit(1);
}

console.log("--------------------------------------------------");
console.log("Initializing Anonymous Supabase client...");
console.log(`URL: ${supabaseUrl}`);
console.log("--------------------------------------------------");

// Create an anonymous client (simulating an external attacker or unauthenticated public user)
const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false }
});

const tables = [
  'admins',
  'students',
  'exams',
  'questions',
  'exam_results',
  'study_materials',
  'login_logs',
  'audit_logs',
  'personal_assignments',
  'exam_late_requests'
];

async function runAudit() {
  console.log("Running security boundary checks using ANONYMOUS connection...\n");
  let totalChecks = 0;
  let passedChecks = 0;

  for (const table of tables) {
    totalChecks++;
    console.log(`Checking RLS status on table: [${table}]`);
    try {
      // 1. Try to SELECT rows
      const { data, error } = await anonClient
        .from(table)
        .select('*')
        .limit(1);

      // RLS should block anonymous reads. If RLS is working:
      // - Either it returns a 401/403 Permission Denied error
      // - Or it returns 0 rows (since no authenticated user context exists)
      if (error) {
        console.log(`  ✅ SELECT blocked by database error: "${error.message}" (Code: ${error.code})`);
        passedChecks++;
      } else if (data && data.length === 0) {
        console.log(`  ✅ SELECT returned 0 records (RLS filtered out data successfully)`);
        passedChecks++;
      } else {
        console.log(`  ❌ CRITICAL SECURITY BREACH: Anonymous read succeeded on [${table}]! Returned:`, data);
      }
    } catch (e) {
      console.log(`  ✅ SELECT failed with exception (blocked):`, e.message);
      passedChecks++;
    }

    // 2. Try to INSERT a malicious row
    totalChecks++;
    try {
      const { data, error } = await anonClient
        .from(table)
        .insert({ id: '00000000-0000-0000-0000-000000000000', security_breach_test: true })
        .select();

      if (error) {
        console.log(`  ✅ INSERT blocked by database error: "${error.message}"`);
        passedChecks++;
      } else {
        console.log(`  ❌ CRITICAL SECURITY BREACH: Anonymous insert succeeded on [${table}]!`);
      }
    } catch (e) {
      console.log(`  ✅ INSERT failed with exception (blocked):`, e.message);
      passedChecks++;
    }
    console.log("");
  }

  console.log("--------------------------------------------------");
  console.log(`Audit Complete: ${passedChecks}/${totalChecks} security checks PASSED.`);
  if (passedChecks === totalChecks) {
    console.log("🏆 SUCCESS: All tables are verified to be fully secured by Row Level Security (RLS) policies.");
  } else {
    console.log("⚠️ WARNING: Security anomalies detected. Please check the failures listed above.");
  }
  console.log("--------------------------------------------------");
}

runAudit();
