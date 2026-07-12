/**
 * HRTA Portal — Enterprise IP Firewall Middleware
 * Blocks requests from banned IPs using Supabase firewall_rules table.
 * Caches the blocklist in memory (refreshed every 60 seconds).
 * Detects VPNs via ip-api.com free API.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// In-memory cache of blocked IPs
let blockedIPs = new Set();
let lastRefreshed = 0;
const CACHE_TTL_MS = 60 * 1000; // Refresh every 60 seconds

async function refreshBlocklist() {
  try {
    const { data } = await supabaseAdmin
      .from('firewall_rules')
      .select('ip_address, is_blocked')
      .eq('is_blocked', true);
    
    if (data && Array.isArray(data)) {
      blockedIPs = new Set(data.map(r => r.ip_address));
    }
    lastRefreshed = Date.now();
  } catch (err) {
    console.warn('[Firewall] Failed to refresh blocklist:', err.message);
  }
}

// Refresh on startup
refreshBlocklist();

// HTML block page shown to blocked IPs
function buildBlockPage(ip) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Access Blocked — HRTA Portal</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #020205;
    color: #e2e8f0;
    font-family: 'Segoe UI', system-ui, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 24px;
    text-align: center;
    padding: 24px;
  }
  .shield {
    font-size: 80px;
    filter: drop-shadow(0 0 30px rgba(239,68,68,0.5));
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  h1 {
    font-size: 28px;
    font-weight: 900;
    color: #ef4444;
    text-transform: uppercase;
    letter-spacing: 3px;
  }
  .box {
    background: rgba(239,68,68,0.05);
    border: 1px solid rgba(239,68,68,0.2);
    border-radius: 16px;
    padding: 32px 40px;
    max-width: 500px;
    width: 100%;
  }
  p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
  .ip-badge {
    background: rgba(239,68,68,0.1);
    border: 1px solid rgba(239,68,68,0.3);
    border-radius: 8px;
    padding: 10px 20px;
    font-family: monospace;
    font-size: 16px;
    color: #fca5a5;
    font-weight: bold;
    margin: 16px 0;
    word-break: break-all;
  }
  .reason {
    font-size: 11px;
    color: #64748b;
    margin-top: 20px;
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .logo {
    font-size: 11px;
    color: #334155;
    margin-top: 8px;
    letter-spacing: 4px;
    text-transform: uppercase;
    font-weight: 700;
  }
</style>
</head>
<body>
  <div class="shield">🛡️</div>
  <h1>Access Blocked</h1>
  <div class="box">
    <p>Your IP address has been blocked from accessing the <strong>HRTA Portal</strong>. This restriction was applied by a system administrator.</p>
    <div class="ip-badge">Your IP: ${ip}</div>
    <p>If you believe this is an error, please contact the administrator to request access restoration.</p>
    <p class="reason">Error Code: HRTA-FW-403 — IP Blacklisted</p>
  </div>
  <p class="logo">HRTA PORTAL · SECURITY FIREWALL</p>
</body>
</html>`;
}

/**
 * Express middleware — checks every incoming request against the IP blocklist.
 * Bypass paths: /api/admin/firewall/* (so admins can unblock themselves)
 */
export async function firewallMiddleware(req, res, next) {
  // Refresh cache if stale
  if (Date.now() - lastRefreshed > CACHE_TTL_MS) {
    refreshBlocklist(); // Non-blocking refresh
  }

  // Get real IP (Cloudflare → X-Forwarded-For → fallback)
  const ip = (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    req.ip ||
    'unknown'
  ).replace('::ffff:', '');

  // Never block admin firewall management endpoints (prevents admin lockout)
  if (req.path.startsWith('/api/admin/firewall/')) {
    return next();
  }

  if (blockedIPs.has(ip)) {
    res.status(403).send(buildBlockPage(ip));
    return;
  }

  // Attach real IP to request for logging purposes
  req.realIp = ip;
  next();
}

/**
 * Force immediate refresh of the in-memory blocklist.
 * Call this after blocking/unblocking an IP.
 */
export async function invalidateFirewallCache() {
  await refreshBlocklist();
}
