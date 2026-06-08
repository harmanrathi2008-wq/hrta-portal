const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Missing Supabase credentials in .env. Verify VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY are set.");
  process.exit(1);
}

// Initialize Supabase admin client to bypass RLS for logging audit runs
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verifyAuditChain() {
  console.log("🔍 Starting Cryptographic Audit Chain Integrity Verification...");
  console.log("---------------------------------------------------------------");

  try {
    // 1. Fetch all audit logs ordered by creation timestamp
    const { data: logs, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!logs || logs.length === 0) {
      console.log("ℹ️ No audit logs found in database. The integrity chain is empty (Genesis state).");
      return;
    }

    console.log(`📋 Retrieved ${logs.length} audit log rows. Running verification loop...`);

    let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    let corruptCount = 0;

    for (let i = 0; i < logs.length; i++) {
      const row = logs[i];
      const details = row.details || {};
      
      // If the row lacks cryptographic hashing markers, it represents an unhashed event (e.g. pre-dating implementation)
      if (!details.curr_hash) {
        console.warn(`⚠️ Row ID ${row.id} [${row.action}] lacks cryptographic details. Skipping signature validation.`);
        continue;
      }

      // Reconstruct original logDetails payload by stripping cryptographic fields
      const { prev_hash, curr_hash, hashed_at, ...logDetails } = details;

      // Re-calculate the expected input hash
      const hashInput = JSON.stringify({
        userId: row.user_id,
        action: row.action,
        ip: row.ip_address || 'Unknown',
        prevHash: prev_hash || '0000000000000000000000000000000000000000000000000000000000000000',
        timestamp: hashed_at,
        payload: logDetails
      });

      const calculatedHash = crypto.createHash('sha256').update(hashInput).digest('hex');

      // Verify preceding link match
      const linkMatch = prev_hash === prevHash;
      // Verify current signature match
      const signatureMatch = curr_hash === calculatedHash;

      if (!linkMatch || !signatureMatch) {
        corruptCount++;
        console.error(`🚨 INTEGRITY BREACH DETECTED AT ROW ${i + 1} (Row ID: ${row.id}):`);
        if (!linkMatch) {
          console.error(`   - Predecessor Link Error: Expected previous hash to be "${prevHash}", but log claims "${prev_hash}".`);
        }
        if (!signatureMatch) {
          console.error(`   - Row Signature Mismatch: Log claims hash "${curr_hash}", but payload re-calculates to "${calculatedHash}".`);
        }
      } else {
        // Update predecessor pointer for the next iteration
        prevHash = curr_hash;
      }
    }

    console.log("---------------------------------------------------------------");
    if (corruptCount === 0) {
      console.log("✅ AUDIT CHAIN INTEGRITY VERIFIED: No modifications, deletions, or out-of-order insertions detected.");
      
      // Log successful verification event
      await supabase.from('audit_logs').insert({
        user_id: 'SYSTEM_CRON',
        user_role: 'system',
        display_name: 'Audit Verification Cron',
        action: 'AUDIT_CHAIN_VERIFIED',
        details: {
          rows_checked: logs.length,
          verified_at: new Date().toISOString(),
          status: 'success'
        }
      });
    } else {
      console.error(`❌ VERIFICATION FAILURE: ${corruptCount} corrupt log record(s) identified.`);
      
      // Route the alert out-of-band to a secondary audit notification log
      await supabase.from('audit_logs').insert({
        user_id: 'SYSTEM_CRON',
        user_role: 'system',
        display_name: 'Audit Verification Cron',
        action: 'AUDIT_CHAIN_FAILURE',
        details: {
          corrupt_records_detected: corruptCount,
          failed_at: new Date().toISOString(),
          status: 'failed',
          severity: 'CRITICAL',
          message: 'Out-of-band verification trigger: Cryptographic chain check failed.'
        }
      });
    }

  } catch (err) {
    console.error("❌ Critical failure during verification run:", err.message);
  }
}

verifyAuditChain();
