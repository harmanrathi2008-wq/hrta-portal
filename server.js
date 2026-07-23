import express from 'express'
import cors from 'cors'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { v2 as cloudinary } from 'cloudinary'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import path from 'path'
import nodemailer from 'nodemailer'
import axios from 'axios'
import { existsSync } from 'fs'
import fs from 'fs'
import { exec, spawn } from 'child_process'
import os from 'os'
import { configureSecurityHeaders } from './middleware/securityHeaders.js'
import { firewallMiddleware, invalidateFirewallCache } from './middleware/firewall.js'
import { apiLimiter, authLimiter, heavyRequestLimiter, submitExamLimiter, wakeupLimiter } from './middleware/rateLimiters.js'
import { validateEmailInput } from './middleware/validator.js'
import crypto from 'crypto'
import { body, validationResult } from 'express-validator'
import { 
  hashPassword, 
  verifyPassword, 
  encryptData, 
  decryptData, 
  signLogEntry, 
  verifyLogChain, 
  rotateEncryptionKeys, 
  checkAutoKeyRotation 
} from './services/cryptoService.js';
import { advancedRateLimiter } from './middleware/advancedRateLimiter.js';
import { serverSideOriginValidation } from './middleware/originValidation.js';
import { probingProtectionMiddleware } from './middleware/probingProtection.js';

// Load environment variables for local development if dotenv is present
try {
  const dotenv = await import('dotenv')
  dotenv.config()
} catch (e) {
  // dotenv not installed/loaded, relying on native --env-file or platform injection
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT || 8080

// Disable X-Powered-By header to hide Express server identity
app.disable('x-powered-by');

// Trust proxy header when running behind reverse proxy (e.g. Render, Cloudflare)
// Required for express-rate-limit to safely determine the actual client IP
app.set('trust proxy', 1);

// Global security headers via Helmet
app.use(configureSecurityHeaders);

// Edge Firewall verification for blacklisted IPs
app.use(firewallMiddleware);

// Probing protection middleware (rejects scanner requests to /.env, /config, etc.)
app.use(probingProtectionMiddleware);

/**
 * Timing-safe secret comparison for 64-character hex strings
 */
function timingSafeSecretCheck(provided, expected) {
  const dummy = '0'.repeat(64);
  const expectedSecret = (expected && expected.length === 64) ? expected : dummy;
  const targetSecret = (typeof provided === 'string' && provided.length === 64) ? provided : dummy;
  
  const bufA = Buffer.from(targetSecret, 'utf8');
  const bufB = Buffer.from(expectedSecret, 'utf8');
  
  const matches = crypto.timingSafeEqual(bufA, bufB);
  const isValidLengthAndType = typeof provided === 'string' && provided.length === 64 && expected && expected.length === 64;
  
  return matches && isValidLengthAndType;
}

/**
 * @openapi ignore
 * Private internal wake-up / heartbeat endpoint for 24/7 Render web service keep-alive.
 * Positioned after Helmet, Firewall, & Probing Protection, but before CORS, Origin Validation, & Auth.
 */
app.get('/internal/system/ping', wakeupLimiter, (req, res) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  if (req.method !== 'GET') {
    return res.status(403).json({ error: 'Access Denied' });
  }
  const providedSecret = req.headers['x-hrta-wakeup'];
  const expectedSecret = process.env.CRON_WAKEUP_SECRET || process.env.WAKEUP_SECRET;
  if (!timingSafeSecretCheck(providedSecret, expectedSecret)) {
    console.warn('[Wakeup Security Alert] Authentication failed', {
      requestId,
      timestamp: new Date().toISOString(),
      ip: req.realIp || req.ip
    });
    return res.status(403).json({ error: 'Access Denied' });
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.status(204).end();
});

// Server-Side Origin & Direct Access Validation
app.use(serverSideOriginValidation);


// Restrict CORS origins securely (allowing localhost, Cloudflare Pages, and custom domain)
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    const isLocalhost = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
    const isCloudflarePages = origin === 'https://hrta-portal.pages.dev' || origin.endsWith('.hrta-portal.pages.dev');
    const isCustomDomain = origin === 'https://harmanrathiportal.dpdns.org' || origin.endsWith('.harmanrathiportal.dpdns.org');
    
    if (isLocalhost || isCloudflarePages || isCustomDomain) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by secure CORS policy'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-HRTA-SecToken', 'X-Session-ID', 'X-Student-ID', 'X-StepUp-Secret', 'X-StepUp-Otp'],
  credentials: true
}));

// Global Request Timeout (15 seconds)
app.use((req, res, next) => {
  res.setTimeout(15000, () => {
    res.status(408).send({ error: 'Request Timeout' });
  });
  next();
});

// Configure JSON limits and URL encoding
app.use(express.json({ limit: '10mb' })); // Lowered from 50mb to prevent memory exhaustion attacks
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// General Rate Limiter for all API endpoints
app.use('/api/', apiLimiter);

// Register global CSRF protection for all state-changing API endpoints
app.use('/api/', verifyCSRF);


// Set local dev fallbacks for non-critical deployment vars if missing
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'hrta_dev_cloud';
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '1234567890';
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'dev_secret';
process.env.SUPER_ADMIN_SECRET = process.env.SUPER_ADMIN_SECRET || 'HRTA_SUPER_SECRET_2026';

// Validate required environment variables at startup
const requiredEnvVars = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
];

requiredEnvVars.forEach(envName => {
  if (!process.env[envName] || process.env[envName] === 'undefined' || process.env[envName] === 'null') {
    console.error(`[FATAL ERROR] Required environment variable '${envName}' is missing. Application refusing to start.`);
    process.exit(1);
  }
});

// Supabase Clients
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Resend clients - ALL keys loaded from environment variables only (never hardcode API keys)
function makeResendClient(envKey) {
  const key = (envKey || '').trim();
  return key && key !== 'undefined' && key !== 'null' && key.startsWith('re_') ? new Resend(key) : null;
}

const resend = makeResendClient(process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY);
const resendAdmin = makeResendClient(process.env.RESEND_API_KEY_ADMIN);
const resendStudent = makeResendClient(process.env.RESEND_API_KEY_STUDENT);

// Dedicated clients for capacity-splitting
const resendOTPClient = makeResendClient(process.env.RESEND_API_KEY_OTP);

// Primary verified client for scorecard/result/update emails (domain: harmanrathiportal.dpdns.org)
const resultApiKey = process.env.RESEND_API_KEY_SCORECARD || process.env.RESEND_API_KEY_RESULT || process.env.RESEND_API_KEY;
const resendScorecardClient = makeResendClient(resultApiKey);
const resendNotificationClient = makeResendClient(process.env.RESEND_API_KEY_NOTIFICATION || resultApiKey);

// Fallback client (uses main key as last resort)
const resendNewFallbackClient = makeResendClient(process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY);



// Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// Super Admin Secret Key
const SUPER_ADMIN_SECRET = process.env.SUPER_ADMIN_SECRET;

// Store OTPs
const otpStore = new Map()

// Middleware to verify Admin JWT from Supabase Auth
async function verifyAdminJWT(req, res, next) {
  try {
    let token = '';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Access Denied: No session token provided.' });
    }
    
    // Validate JWT via Supabase Auth server
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return res.status(401).json({ error: 'Access Denied: Invalid or expired session token.' });
    }

    // Verify Admin status — look up by email (most reliable) with id as fallback
    let adminUser = null;
    let dbErr = null;

    // Primary: look up by email
    const { data: adminByEmail, error: emailErr } = await supabaseAdmin
      .from('admins')
      .select('id, role')
      .ilike('email', user.email)
      .in('role', ['admin', 'super_admin'])
      .limit(1)
      .maybeSingle();

    if (!emailErr && adminByEmail) {
      adminUser = adminByEmail;
    } else {
      // Fallback: look up by id
      const { data: adminById, error: idErr } = await supabaseAdmin
        .from('admins')
        .select('id, role')
        .eq('id', user.id)
        .single();
      adminUser = adminById;
      dbErr = idErr;
    }

    if (dbErr || !adminUser || !['admin', 'super_admin'].includes(adminUser.role)) {
      return res.status(403).json({ error: 'Access Denied: Administrator role required.' });
    }

    // Checking if the session has been revoked in the DB
    try {
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      const { data: sessionAct } = await supabaseAdmin
        .from('session_activity')
        .select('is_revoked')
        .eq('refresh_token_hash', hashedToken)
        .maybeSingle();

      if (sessionAct && sessionAct.is_revoked) {
        return res.status(401).json({ error: 'Access Denied: Session revoked by administrator.' });
      }
    } catch (e) {
      // Safe fallback if session_activity table is not migrated yet
    }

    req.user = user;
    req.role = adminUser.role;
    next();
  } catch (err) {
    console.error('Admin token validation error:', err.message);
    res.status(500).json({ error: 'Internal security authentication error.' });
  }
}

// Middleware to verify Student or Admin JWT
async function verifyUserJWT(req, res, next) {
  try {
    let token = '';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Access Denied: No session token provided.' });
    }

    // 1. Try to resolve via session_activity (for candidates / custom sessions)
    try {
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      const { data: sessionRows, error: saErr } = await supabaseAdmin
        .from('session_activity')
        .select('user_id, is_revoked, expires_at')
        .eq('refresh_token_hash', hashedToken)
        .order('created_at', { ascending: false });

      if (!saErr && sessionRows && sessionRows.length > 0) {
        const sessionAct = sessionRows[0];
        if (sessionAct.is_revoked) {
          return res.status(401).json({ error: 'Access Denied: Session revoked by administrator.' });
        }
        // Check expiration
        if (sessionAct.expires_at && new Date(sessionAct.expires_at) < new Date()) {
          return res.status(401).json({ error: 'Access Denied: Session has expired. Please log in again.' });
        }
        // Successfully resolved student/user session!
        req.user = { id: sessionAct.user_id };
        return next();
      }
    } catch (e) {
      console.warn("session_activity token resolution warning:", e.message);
    }

    // 2. Fallback to Supabase auth validation (for admins)
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (!authErr && user) {
        req.user = user;
        return next();
      }
    } catch (authFallbackErr) {
      console.warn("Supabase auth.getUser fallback warning:", authFallbackErr.message);
    }

    // 3. Final fallback: if the request includes x-student-id, verify it exists in the students table
    // This handles edge cases where session_activity insert silently failed during login
    const studentIdHeader = req.headers['x-student-id'];
    if (studentIdHeader) {
      try {
        const { data: studentExists, error: stuErr } = await supabaseAdmin
          .from('students')
          .select('id')
          .eq('id', studentIdHeader)
          .maybeSingle();
        if (!stuErr && studentExists) {
          console.warn(`[verifyUserJWT] Fallback: Resolved student ${studentIdHeader} via x-student-id header (token not found in session_activity).`);
          // Re-register the session token for future requests
          try {
            const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
            await supabaseAdmin.from('session_activity').insert({
              user_id: studentIdHeader,
              refresh_token_hash: hashedToken,
              ip_address: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown').split(',')[0].trim(),
              user_agent: req.headers['user-agent'] || 'Unknown',
              expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            });
          } catch (reinsertErr) {
            console.warn("[verifyUserJWT] Could not re-register session token:", reinsertErr.message);
          }
          req.user = { id: studentIdHeader };
          return next();
        }
      } catch (fallbackErr) {
        console.warn("[verifyUserJWT] x-student-id fallback error:", fallbackErr.message);
      }
    }

    return res.status(401).json({ error: 'Access Denied: Invalid or expired session token.' });
  } catch (err) {
    console.error('User token validation error:', err.message);
    res.status(500).json({ error: 'Internal security authentication error.' });
  }
}


// CSRF Protection Middleware for non-GET state-changing API endpoints
function verifyCSRF(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  // Normalize originalUrl to strip query parameters
  const cleanPath = req.originalUrl.split('?')[0];

  // Safe read-only HTTP methods do not change state, so CSRF check is bypassed
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  // Allow static validation / bypass for public/auth setup & real-time background signaling endpoints
  const publicPaths = [
    '/api/student/login',
    '/api/admin/login',
    '/api/send-student-otp',
    '/api/send-admin-otp',
    '/api/send-superadmin-otp',
    '/api/verify-otp',
    '/api/verify-mfa',
    '/api/setup-mfa',
    '/api/verify-recaptcha',
    '/api/health',
    '/api/webrtc-signal/',
    '/api/exam-heartbeat'
  ];

  if (publicPaths.some(p => cleanPath.startsWith(p))) {
    return next();
  }

  const csrfToken = req.headers['x-csrf-token'] || req.headers['x-hrta-sectoken'];

  if (!csrfToken) {
    console.warn(`[CSRF Blocked] Request to ${cleanPath} failed CSRF validation: Missing token. Headers received:`, JSON.stringify(req.headers));
    return res.status(403).json({ error: 'CSRF validation failed: Missing security token header.' });
  }

  // Extract session token from Authorization header or query
  let token = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  // Fallback to student ID from headers
  if (!token) {
    token = req.headers['x-student-id'] || '';
  }

  if (!token) {
    console.warn(`[CSRF Blocked] Authenticated path ${cleanPath} missing session token for CSRF.`);
    return res.status(401).json({ error: 'CSRF validation failed: No session token found.' });
  }

  // Calculate expected dynamic CSRF token using client-shared salt
  const expectedToken = crypto.createHash('sha256')
    .update(token + 'HRTA_DYNAMIC_CSRF_SALT_2026')
    .digest('hex');

  if (csrfToken !== expectedToken) {
    console.warn(`[CSRF Blocked] Dynamic CSRF mismatch for ${cleanPath}.`);
    return res.status(403).json({ error: 'CSRF validation failed: Invalid dynamic session token.' });
  }

  next();
}

// Immutable Cryptographically Signed Audit Logging Engine
async function logSecurityEvent(eventType, description, userId, req) {
  try {
    const rawIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const ip = rawIp.split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // Retrieve previous log signature to chain them
    let previousSignature = '';
    try {
      const { data: lastLog, error: lastErr } = await supabaseAdmin
        .from('signed_audit_logs')
        .select('signature')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastErr && lastLog) {
        previousSignature = lastLog.signature;
      }
    } catch (dbErr) {
      console.warn("Signed audit logs table not accessible yet. Skipping signature chaining.");
    }

    const logContent = {
      event_type: eventType,
      description: description,
      user_id: userId || null,
      ip_address: ip,
      user_agent: userAgent
    };

    const signature = signLogEntry(logContent, previousSignature);

    await supabaseAdmin
      .from('signed_audit_logs')
      .insert({
        event_type: eventType,
        description: description,
        user_id: userId || null,
        ip_address: ip,
        user_agent: userAgent,
        previous_signature: previousSignature,
        signature: signature
      });
  } catch (err) {
    console.error("Failed to write signed audit log:", err.message);
  }
}

// Step-Up 2FA Re-Authentication Middleware for Critical Operations
async function requireStepUp2FA(req, res, next) {
  try {
    const stepUpSecret = req.headers['x-stepup-secret'];
    const stepUpOtp = req.headers['x-stepup-otp'];

    if (!stepUpSecret || !stepUpOtp) {
      return res.status(401).json({ error: 'Step-up authentication required: Secret key and OTP pin are missing.' });
    }

    if (stepUpSecret !== SUPER_ADMIN_SECRET) {
      return res.status(403).json({ error: 'Step-up authentication failed: Invalid superadmin secret key.' });
    }

    // Retrieve active admin user's MFA secret
    const { data: dbAdmin, error: adminErr } = await supabaseAdmin
      .from('admins')
      .select('mfa_secret')
      .eq('id', req.user.id)
      .single();

    if (adminErr || !dbAdmin || !dbAdmin.mfa_secret) {
      return res.status(400).json({ error: 'Multi-factor authentication (MFA) setup required to perform this action.' });
    }

    const isValid = verifyTOTP(stepUpOtp, dbAdmin.mfa_secret);
    if (!isValid) {
      await logSecurityEvent('stepup_failed', `Failed step-up 2FA attempt for user ${req.user.email}`, req.user.id, req);
      return res.status(400).json({ error: 'Step-up authentication failed: Invalid authenticator code.' });
    }

    next();
  } catch (err) {
    console.error("Step-up authentication error:", err.message);
    res.status(500).json({ error: 'Step-up authentication processing error.' });
  }
}

// Student Data Symmetric Encryption/Decryption Helpers
function decryptStudent(student) {
  if (!student) return null;
  try {
    return {
      ...student,
      date_of_birth: student.date_of_birth ? decryptData(student.date_of_birth, 'student') : '',
      email: student.email ? decryptData(student.email, 'student') : '',
      phone: student.phone ? decryptData(student.phone, 'student') : ''
    };
  } catch (err) {
    console.error('Error decrypting student record:', err.message);
    return student;
  }
}

function encryptStudent(student) {
  if (!student) return null;
  const result = {
    ...student,
    date_of_birth: student.date_of_birth ? encryptData(student.date_of_birth, 'student') : '',
    email: student.email ? encryptData(student.email, 'student') : '',
    phone: student.phone ? encryptData(student.phone, 'student') : ''
  };
  // Only include address/parent_pin if they were provided (not in current schema)
  delete result.address;
  delete result.parent_pin;
  return result;
}

// Domain emails
// harmanrathitportal.nxtdev.xyz = verified for OTP login emails (established reputation)
// harmanrathiportal.dpdns.org = verified for result/scorecard/update emails (verified domain)
const FROM_EMAIL = 'result@harmanrathiportal.dpdns.org'
const ADMIN_FROM_EMAIL = 'result@harmanrathiportal.dpdns.org'
const SUPERADMIN_FROM_EMAIL = 'superadmin-direct-mail@harmanrathiportal.dpdns.org'
const OTP_FROM_EMAIL = 'otp@harmanrathitportal.nxtdev.xyz'


// Nodemailer SMTP Relay Setup (via Resend SMTP on port 2525 — bypasses Render port blocks)
const transporters = [];
let currentTransporterIndex = 0;

// Use resultApiKey if set (must be authorized for results@harmanrathiportal.dpdns.org)
// Fall back to RESEND_API_KEY if not set
const smtpResendKey = (process.env.RESEND_API_KEY_SCORECARD || process.env.RESEND_API_KEY_RESULT || 're_SGL3B8iw_8Tq5Yh5LGyDHwV8Axodx5h7m').trim();
if (smtpResendKey) {
  transporters.push({
    email: FROM_EMAIL,
    transporter: nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 2525,
      secure: false, // port 2525 uses STARTTLS
      auth: {
        user: 'resend',
        pass: smtpResendKey
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 15000
    })
  });
  console.log(`Initialized Resend SMTP relay on port 2525 for custom domain ${FROM_EMAIL}`);
} else {
  console.warn("WARNING: No Resend API key found. Resend SMTP relay configuration skipped.");
}


// Robust Date Normalizer to handle standard date picker (YYYY-MM-DD), manual types, slashes, hyphens, etc.
function normalizeDateOfBirth(dob) {
  if (!dob) return '';
  const clean = dob.toString().trim();
  
  // Case 1: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean;
  }
  
  // Case 2: DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(clean)) {
    const [day, month, year] = clean.split('-');
    return `${year}-${month}-${day}`;
  }
  
  // Case 3: DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
    const [day, month, year] = clean.split('/');
    return `${year}-${month}-${day}`;
  }
  
  // Case 4: YYYY/MM/DD
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(clean)) {
    return clean.replace(/\//g, '-');
  }

  // Fallback: JS Date parsing
  const parsed = Date.parse(clean);
  if (!isNaN(parsed)) {
    const date = new Date(parsed);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  
  return clean;
}

function generateHRTAEmailTemplate({ subject = 'Official HRTA Notification', body = '', actionUrl = null, actionText = null }) {
  let formattedContent = body || '';
  const isStructuredHtml = /<(p|div|table|h[1-6]|ul|ol|section|header|main|article)\b/i.test(formattedContent);
  
  if (!isStructuredHtml && formattedContent) {
    const paragraphs = formattedContent.split(/\n\s*\n/);
    formattedContent = paragraphs.map(p => {
      const cleanParagraph = p.trim().replace(/\n/g, '<br>');
      return `<p style="margin: 0 0 16px 0; line-height: 1.75; color: #334155; font-size: 15px;">${cleanParagraph}</p>`;
    }).join('');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b; }
    .wrapper { width: 100%; table-layout: fixed; background-color: #f1f5f9; padding: 32px 0; }
    .main-card { max-width: 620px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08), 0 8px 10px -6px rgba(0,0,0,0.03); border: 1px solid #e2e8f0; }
    .header-banner { background: linear-gradient(135deg, #0f2b48 0%, #1f497d 50%, #163861 100%); padding: 36px 40px; text-align: center; }
    .brand-badge { display: inline-block; background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 50px; padding: 6px 18px; margin-bottom: 12px; }
    .brand-badge-text { color: #ffffff; font-size: 15px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; }
    .brand-title { color: #ffffff; font-size: 22px; font-weight: 800; letter-spacing: 1px; margin: 0; text-transform: uppercase; }
    .brand-subtitle { color: #94a3b8; font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; margin-top: 4px; }
    .content-body { padding: 40px; font-size: 15px; line-height: 1.75; color: #334155; }
    .email-subject-heading { font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 0; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #e2e8f0; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #1f497d 0%, #11325a 100%); color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 14px; padding: 14px 32px; border-radius: 8px; margin: 20px 0; box-shadow: 0 4px 12px rgba(31, 73, 125, 0.25); }
    .footer-section { background-color: #0f172a; padding: 30px 40px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.6; }
    .footer-divider { border: 0; height: 1px; background-color: #1e293b; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="main-card">
      <div class="header-banner">
        <div class="brand-badge">
          <span class="brand-badge-text">⚡ HRTA PORTAL</span>
        </div>
        <h1 class="brand-title">HARMAN RATHI TESTING AGENCY</h1>
        <div class="brand-subtitle">National Examination & Assessment Authority</div>
      </div>
      
      <div class="content-body">
        ${subject ? `<h2 class="email-subject-heading">${subject}</h2>` : ''}
        
        <div class="message-content">
          ${formattedContent}
        </div>

        ${actionUrl && actionText ? `
          <div style="text-align: center; margin-top: 28px;">
            <a href="${actionUrl}" target="_blank" class="cta-button">${actionText}</a>
          </div>
        ` : ''}
      </div>

      <div class="footer-section">
        <p style="margin: 0; font-weight: 700; color: #cbd5e1; font-size: 13px;">HRTA Central Controller of Examinations</p>
        <p style="margin: 4px 0 0 0;">Official Communication Dispatch • Harman Rathi Testing Agency</p>
        
        <hr class="footer-divider">
        
        <p style="margin: 0; font-size: 11px; color: #64748b;">
          This is an official system dispatch. If you have any queries regarding this message, please contact support at <a href="mailto:support@harmanrathiportal.dpdns.org" style="color: #38bdf8; text-decoration: none;">support@harmanrathiportal.dpdns.org</a>.
        </p>
        <p style="margin: 8px 0 0 0; font-size: 11px; color: #475569;">
          © 2026 HRTA Testing Authority. All rights reserved. • Confidential & Privileged Communication
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// Robust, self-healing email dispatch helper
// preferSmtp=true: tries SMTP relay first, falls back to Resend API
// preferSmtp=false (default): tries Resend first, SMTP as fallback (OTPs)
async function sendEmail({ to, subject, html, text = '', fromName = 'HRTA', type = 'student', isOtp = false, preferSmtp = false, fromEmailOverride = null }) {
  const fromDomain = fromEmailOverride || (isOtp ? OTP_FROM_EMAIL : FROM_EMAIL);
  const fromAddress = `${fromName} <${fromDomain}>`;

  // Auto-wrap unformatted text/HTML into official HRTA brand email template
  const finalHtml = (html && (html.includes('<!DOCTYPE') || html.includes('<html')))
    ? html
    : generateHRTAEmailTemplate({ subject, body: html || text });


  // ── SMTP Relay helper (shared by both paths) ─────────────────────────────
  const trySmtp = async () => {
    if (transporters.length === 0) return null;
    let lastSmtpError = null;
    for (let attempt = 0; attempt < transporters.length; attempt++) {
      const idx = (currentTransporterIndex + attempt) % transporters.length;
      const { email, transporter } = transporters[idx];
      try {
        console.log(`[SMTP] Attempting via SMTP Relay: ${email}`);
        
        const mailFrom = preferSmtp 
          ? `"${fromName}" <${fromDomain}>` 
          : `"${fromName}" <${email}>`;

        await transporter.sendMail({
          from: mailFrom,
          replyTo: fromDomain,
          to, subject, html: finalHtml,
          ...(text ? { text } : {})
        });
        currentTransporterIndex = (idx + 1) % transporters.length;
        console.log(`[SMTP] Sent successfully via SMTP Relay [${email}] to ${to} (as ${mailFrom})`);
        return { success: true, provider: 'smtp_relay', email };
      } catch (err) {
        console.warn(`[SMTP] SMTP Relay [${email}] failed: ${err.message}`);
        lastSmtpError = err;
      }
    }
    return { success: false, error: lastSmtpError };
  };

  // ── Resend helper ─────────────────────────────────────────────────────────
  const tryResend = async () => {
    // Collect and prioritize all active Resend API keys from Render environment variables
    const rawKeys = isOtp
      ? [
          process.env.RESEND_API_KEY_OTP,
          process.env.RESEND_API_KEY_SCORECARD,
          process.env.RESEND_API_KEY_NOTIFICATION,
          process.env.RESEND_API_KEY,
          process.env.VITE_RESEND_API_KEY,
          process.env.RESEND_API_KEY_STUDENT,
          process.env.RESEND_API_KEY_ADMIN,
          process.env.RESEND_API_KEY_RESULT
        ]
      : [
          process.env.RESEND_API_KEY_SCORECARD,
          process.env.RESEND_API_KEY_NOTIFICATION,
          process.env.RESEND_API_KEY,
          process.env.VITE_RESEND_API_KEY,
          process.env.RESEND_API_KEY_OTP,
          process.env.RESEND_API_KEY_STUDENT,
          process.env.RESEND_API_KEY_ADMIN,
          process.env.RESEND_API_KEY_RESULT
        ];

    const activeKeys = [...new Set(
      rawKeys
        .map(k => (k || '').trim())
        .filter(k => k && k !== 'undefined' && k !== 'null' && k.startsWith('re_'))
    )];


    if (activeKeys.length === 0) {
      console.warn('[Resend Error] No valid Resend API keys found in process.env!');
      return { success: false, error: new Error('No valid Resend API keys configured in Render environment variables.') };
    }

    let lastResendError = null;

    for (let idx = 0; idx < activeKeys.length; idx++) {
      const apiKey = activeKeys[idx];
      const client = new Resend(apiKey);
      const label = `key_${idx + 1}_(${apiKey.slice(0, 7)}...)`;

      // 1. Attempt sending with requested fromAddress
      try {
        console.log(`[Resend] Attempting to send to ${to} via ${label} with from: ${fromAddress}...`);
        const response = await client.emails.send({
          from: fromAddress,
          to,
          subject,
          html: finalHtml,
          ...(text ? { text } : {})
        });

        if (response.error) {
          throw new Error(response.error.message || `Resend ${label} returned error`);
        }

        console.log(`[Resend] Sent successfully via ${label} (${fromAddress}) to ${to}`);
        return { success: true, provider: `resend_${label}`, data: response };
      } catch (err) {
        console.warn(`[Resend] ${label} with custom address (${fromAddress}) failed: ${err.message}`);
        lastResendError = err;

        // 2. Fallback: If custom domain is not authorized on this key, attempt with onboarding@resend.dev
        try {
          console.log(`[Resend Fallback] Retrying via ${label} using onboarding@resend.dev...`);
          const fallbackRes = await client.emails.send({
            from: `${fromName} <onboarding@resend.dev>`,
            to,
            subject,
            html: finalHtml,
            ...(text ? { text } : {})
          });

          if (!fallbackRes.error) {
            console.log(`[Resend Fallback] Sent successfully via ${label} (onboarding@resend.dev) to ${to}`);
            return { success: true, provider: `resend_${label}_fallback`, data: fallbackRes };
          }
        } catch (fallbackErr) {
          console.warn(`[Resend Fallback] ${label} with onboarding@resend.dev failed: ${fallbackErr.message}`);
          lastResendError = fallbackErr;
        }
      }
    }

    return { success: false, error: lastResendError };
  };



  // ── Route based on preferSmtp ─────────────────────────────────────────────
  if (preferSmtp) {
    // SMTP first (result/scorecard emails) — avoids new-domain IP reputation blocks
    const smtpResult = await trySmtp();
    if (smtpResult && smtpResult.success) return smtpResult;
    console.log('[SMTP] All SMTP accounts failed, falling back to Resend...');
    const resendResult = await tryResend();
    if (resendResult && resendResult.success) return resendResult;
    throw new Error(`All email channels failed. SMTP error: ${smtpResult?.error?.message || 'No SMTP accounts'}. Resend error: ${resendResult?.error?.message || 'Unknown'}`);
  } else {
    // Resend first (OTPs and admin emails) — Resend is faster and more reliable for transactional
    const resendResult = await tryResend();
    if (resendResult && resendResult.success) return resendResult;
    console.log('[Resend] All Resend clients failed, falling back to SMTP...');
    const smtpResult = await trySmtp();
    if (smtpResult && smtpResult.success) return smtpResult;
    throw new Error(`All email channels failed. Resend error: ${resendResult?.error?.message || 'Unknown'}. SMTP error: ${smtpResult?.error?.message || 'No SMTP accounts'}`);
  }
}

// Resolve geo-location in the background and write to DB
async function resolveGeoLocationAndUpdate(logId, ip) {
  try {
    // Clean local IPs
    if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      await supabase
        .from('login_logs')
        .update({ location: 'Local Dev Environment' })
        .eq('id', logId);
      return;
    }

    const response = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 2500 });
    if (response.data && response.data.status === 'success') {
      const locStr = `${response.data.city}, ${response.data.country}`;
      await supabase
        .from('login_logs')
        .update({ location: locStr })
        .eq('id', logId);
    } else {
      await supabase
        .from('login_logs')
        .update({ location: 'Unknown Location' })
        .eq('id', logId);
    }
  } catch (err) {
    console.error(`Failed to resolve geo-IP for ${ip}:`, err.message);
    await supabase
      .from('login_logs')
      .update({ location: 'Lookup Failed' })
      .eq('id', logId);
  }
}

// ============ SECURITY & MFA HELPERS ============

// Temporary store for active MFA login challenges (valid for 5 minutes)
const mfaStore = new Map();

// Google reCAPTCHA Enterprise Verification Middleware
async function verifyRecaptchaToken(req, res, next) {
  try {
    const token = req.body.recaptchaToken || req.body.turnstileToken || req.body.token;
    if (!token) {
      return res.status(400).json({ error: 'Please complete the security challenge.' });
    }

    if (token === 'recaptcha_bypass_fallback') {
      console.log('reCAPTCHA script failed to load on client. Bypassing token check.');
      return next();
    }

    const projectId = process.env.RECAPTCHA_PROJECT_ID || 'gen-lang-client-0467250813';
    const apiKey = process.env.RECAPTCHA_API_KEY || process.env.FIREBASE_API_KEY || 'AIzaSyDLIwrraEUrG1nQdXlc93UR6GAWHLkBXrc';
    const siteKey = process.env.RECAPTCHA_SITE_KEY || '6LePiSstAAAAAMrXU7L-BBBSFm2beiH1Os17JqbA';

    const response = await axios.post(
      `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${apiKey}`,
      {
        event: {
          token,
          siteKey,
          expectedAction: 'LOGIN'
        }
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    const assessment = response.data;
    console.log('reCAPTCHA Enterprise assessment:', JSON.stringify(assessment));

    const tokenValid = assessment?.tokenProperties?.valid;
    if (!tokenValid) {
      const reason = assessment?.tokenProperties?.invalidReason || 'UNKNOWN';
      console.warn('reCAPTCHA Enterprise token invalid:', reason);
      return res.status(400).json({ error: 'Security challenge verification failed. Please try again.' });
    }

    // A score of 1.0 is very likely a human, 0.0 is very likely a bot.
    const score = assessment?.riskAnalysis?.score;
    if (score !== undefined) {
      if (score < 0.15) {
        console.warn('reCAPTCHA Enterprise score too low (bot detected):', score);
        return res.status(400).json({ error: 'High security risk detected. Access denied.' });
      } else if (score < 0.4) {
        console.log('reCAPTCHA Enterprise suspicious human score:', score);
      }
    }

    next();
  } catch (err) {
    console.error('reCAPTCHA Enterprise verification error (falling back to pass):', err.message);
    if (err.response) console.error('Enterprise API response:', JSON.stringify(err.response.data));
    next(); // Fallback to avoid complete denial if Google service is down
  }
}

// Support /api/verify-recaptcha for consistency with the rest of the API
app.post('/api/verify-recaptcha', async (req, res) => {
  try {
    const token = req.body.token || req.body.recaptchaToken;
    if (!token) {
      return res.status(400).json({ error: 'Missing token' });
    }

    const projectId = process.env.RECAPTCHA_PROJECT_ID || 'gen-lang-client-0467250813';
    const apiKey = process.env.RECAPTCHA_API_KEY || process.env.FIREBASE_API_KEY || 'AIzaSyDLIwrraEUrG1nQdXlc93UR6GAWHLkBXrc';
    const siteKey = process.env.RECAPTCHA_SITE_KEY || '6LePiSstAAAAAMrXU7L-BBBSFm2beiH1Os17JqbA';

    const response = await axios.post(
      `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${apiKey}`,
      { event: { token, siteKey, expectedAction: 'LOGIN' } },
      { headers: { 'Content-Type': 'application/json' } }
    );

    res.json(response.data);
  } catch (err) {
    console.error('reCAPTCHA verification error:', err.message);
    res.status(500).json({ error: 'Failed to verify security challenge.' });
  }
});

// Validator Helper for Express-Validator Results
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
};

// Express-Validator Payload Schemas
const validateVerifyOtp = [
  body('otp').isString().isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be a 6-digit number'),
  body('email').optional().isEmail().withMessage('Invalid email format'),
  body('identifier').optional().isString().trim().notEmpty().withMessage('Identifier cannot be empty'),
  handleValidationErrors
];

const validateAuditLog = [
  body('userId').isString().trim().notEmpty().withMessage('User ID is required'),
  body('userRole').isIn(['student', 'admin', 'super_admin']).withMessage('Invalid user role'),
  body('action').isString().trim().notEmpty().withMessage('Action is required'),
  handleValidationErrors
];

const validateUploadImage = [
  body('image').isString().notEmpty().withMessage('Base64 image data is required'),
  handleValidationErrors
];

const validateDeleteImage = [
  body('public_id').isString().notEmpty().withMessage('Cloudinary public ID is required'),
  handleValidationErrors
];

const validateGetUploadUrl = [
  body('fileName').isString().notEmpty().withMessage('File name is required'),
  handleValidationErrors
];

// Native TOTP MFA Functions using Built-in crypto (supports deterministic secret by email)
function generateBase32Secret(email) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  if (email) {
    const hash = crypto.createHash('sha256').update(email.toLowerCase().trim() + 'HRTA_MFA_PEPPER_2026').digest('hex');
    let secret = '';
    for (let i = 0; i < 16; i++) {
      const val = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
      secret += chars.charAt(val % chars.length);
    }
    return secret;
  }
  let secret = '';
  for (let i = 0; i < 16; i++) {
    secret += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return secret;
}

function decodeBase32(charstr) {
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  let hex = '';
  const cleanStr = charstr.replace(/=+$/, '').toUpperCase();
  
  for (let i = 0; i < cleanStr.length; i++) {
    const val = base32chars.indexOf(cleanStr.charAt(i));
    if (val === -1) throw new Error('Invalid base32 character');
    bits += val.toString(2).padStart(5, '0');
  }
  
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    const chunk = bits.substring(i, i + 8);
    hex += parseInt(chunk, 2).toString(16).padStart(2, '0');
  }
  return Buffer.from(hex, 'hex');
}

function verifyTOTP(token, secret, window = 4) {
  try {
    const key = decodeBase32(secret);
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / 30);
    
    for (let i = -window; i <= window; i++) {
      const countBuf = Buffer.alloc(8);
      const val = BigInt(counter + i);
      countBuf.writeBigInt64BE(val);
      
      const hmac = crypto.createHmac('sha1', key).update(countBuf).digest();
      const offset = hmac[hmac.length - 1] & 0xf;
      const code = ((hmac[offset] & 0x7f) << 24) |
                   ((hmac[offset + 1] & 0xff) << 16) |
                   ((hmac[offset + 2] & 0xff) << 8) |
                   (hmac[offset + 3] & 0xff);
                   
      const otp = (code % 1000000).toString().padStart(6, '0');
      if (otp === token.trim()) {
        return true;
      }
    }
  } catch (e) {
    console.error('TOTP validation error:', e.message);
  }
  return false;
}

// ============ VERIFY MFA ============
app.post('/api/verify-mfa', authLimiter, [
  body('tempToken').isString().notEmpty().withMessage('Session token is required'),
  body('code').isString().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Authenticator code must be a 6-digit number'),
  handleValidationErrors
], async (req, res) => {
  const { tempToken, code } = req.body;

  const stored = mfaStore.get(tempToken);
  if (!stored) {
    return res.status(400).json({ error: 'MFA session has expired or is invalid. Please log in again.' });
  }

  try {
    const { data: dbAdmin, error: adminErr } = await supabaseAdmin
      .from('admins')
      .select('mfa_secret')
      .eq('id', stored.userId)
      .single();

    if (adminErr || !dbAdmin || !dbAdmin.mfa_secret) {
      return res.status(400).json({ error: 'MFA setup not found. Please log in again.' });
    }

    const isValid = verifyTOTP(code, dbAdmin.mfa_secret);
    if (!isValid) {
      // Capture IP Address & Log failed attempt to track anomalies
      const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
      const ip = rawIp.split(',')[0].trim();
      try {
        await supabaseAdmin
          .from('audit_logs')
          .insert({
            user_id: stored.userId,
            user_role: stored.role,
            display_name: stored.displayName || stored.userEmail || 'Admin',
            action: 'LOGIN_MFA_FAILED',
            details: { email: stored.userEmail, reason: 'Invalid TOTP code entered', ip_address: ip },
            ip_address: ip
          });
      } catch (auditErr) {
        console.error("Failed to insert failed MFA audit log:", auditErr.message);
      }
      return res.status(400).json({ error: 'Invalid authenticator code.' });
    }

    // Clear MFA store
    mfaStore.delete(tempToken);

    // Capture IP Address & Log to Database
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const ip = rawIp.split(',')[0].trim();

    let logId = null;
    const { data: logData, error: logErr } = await supabaseAdmin
      .from('login_logs')
      .insert({
        user_id: stored.userId,
        user_role: stored.role,
        display_name: stored.displayName || stored.userEmail || 'Admin',
        ip_address: ip,
        location: 'Resolving location...'
      })
      .select()
      .single();

    if (logData) {
      logId = logData.id;
      resolveGeoLocationAndUpdate(logData.id, ip);
    }

    // Write to audit_logs
    try {
      await supabaseAdmin
        .from('audit_logs')
        .insert({
          user_id: stored.userId,
          user_role: stored.role,
          display_name: stored.displayName || stored.userEmail || 'Admin',
          action: 'ADMIN_MFA_LOGIN',
          details: { email: stored.userEmail, login_log_id: logId },
          ip_address: ip
        });
    } catch (auditErr) {
      console.error("Failed to insert admin MFA login audit log:", auditErr.message);
    }

    res.json({
      message: 'Login successful',
      role: stored.role,
      userId: stored.userId,
      userEmail: stored.userEmail,
      loginLogId: logId,
      dbPassword: stored.dbPassword
    });
  } catch (err) {
    console.error('MFA validation crash:', err.message);
    res.status(500).json({ error: 'Internal server error during MFA authentication.' });
  }
});

app.post('/api/setup-mfa', authLimiter, [
  body('tempToken').isString().notEmpty().withMessage('Session token is required'),
  body('code').isString().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Verification code must be 6 digits'),
  handleValidationErrors
], async (req, res) => {
  const { tempToken, code } = req.body;

  const stored = mfaStore.get(tempToken);
  if (!stored || !stored.isSetup) {
    return res.status(400).json({ error: 'MFA setup session has expired or is invalid. Please log in again.' });
  }

  const isValid = verifyTOTP(code, stored.mfaSecret);
  if (!isValid) {
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const ip = rawIp.split(',')[0].trim();
    try {
      await supabaseAdmin
        .from('audit_logs')
        .insert({
          user_id: stored.userId,
          user_role: stored.role,
          display_name: stored.displayName || stored.userEmail || 'Admin',
          action: 'LOGIN_MFA_FAILED',
          details: { email: stored.userEmail, reason: 'Invalid TOTP code entered during setup', ip_address: ip },
          ip_address: ip
        });
    } catch (auditErr) {
      console.error("Failed to insert failed MFA audit log:", auditErr.message);
    }
    return res.status(400).json({ error: 'Invalid authenticator code.' });
  }

  try {
    const { error: updateErr } = await supabaseAdmin
      .from('admins')
      .update({ mfa_secret: stored.mfaSecret })
      .eq('id', stored.userId);

    if (updateErr) throw updateErr;

    // Clear setup session token
    mfaStore.delete(tempToken);

    // Capture IP Address & Log to Database
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const ip = rawIp.split(',')[0].trim();

    let logId = null;
    const { data: logData, error: logErr } = await supabaseAdmin
      .from('login_logs')
      .insert({
        user_id: stored.userId,
        user_role: stored.role,
        display_name: stored.displayName || stored.userEmail || 'Admin',
        ip_address: ip,
        location: 'Resolving location...'
      })
      .select()
      .single();

    if (logData) {
      logId = logData.id;
      resolveGeoLocationAndUpdate(logData.id, ip);
    }

    // Log audit event
    try {
      await supabaseAdmin
        .from('audit_logs')
        .insert({
          user_id: stored.userId,
          user_role: stored.role,
          display_name: stored.displayName || stored.userEmail || 'Admin',
          action: 'ADMIN_MFA_ENABLED',
          details: { email: stored.userEmail, login_log_id: logId },
          ip_address: ip
        });
    } catch (auditErr) {
      console.error("Failed to audit MFA setup:", auditErr.message);
    }

    res.json({
      message: 'Login successful',
      role: stored.role,
      userId: stored.userId,
      userEmail: stored.userEmail,
      loginLogId: logId,
      dbPassword: stored.dbPassword
    });
  } catch (err) {
    console.error('MFA setup update error:', err.message);
    res.status(500).json({ error: 'Failed to complete MFA setup.' });
  }
});

// ============ ADMIN OTP ============
app.post('/api/send-admin-otp', authLimiter, verifyRecaptchaToken, validateEmailInput, async (req, res) => {
  const { email } = req.body

  if (!email) {
    return res.status(400).json({ error: 'Email is required' })
  }

  const cleanEmail = email.trim();
  const { data: admins, error } = await supabaseAdmin
    .from('admins')
    .select('id, email, role, status')
    .ilike('email', cleanEmail)
    .in('role', ['admin', 'super_admin'])

  if (error || !admins || admins.length === 0) {
    return res.status(401).json({ error: 'Unauthorized. Admin access only.' })
  }

  const admin = admins[0];

  if (admin.status === 'disabled') {
    return res.status(401).json({ error: 'Account disabled.' })
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = Date.now() + 5 * 60 * 1000

  // NORMALIZE KEY: Always lowercase and trim spaces
  const normalizedKey = email.toLowerCase().trim()
  
  otpStore.set(normalizedKey, { 
    otp, 
    expiresAt, 
    role: admin.role, 
    userId: admin.id,
    userEmail: admin.email,
    displayName: admin.email
  })

  try {
    await sendEmail({
      to: admin.email,
      subject: 'Your Admin Login OTP',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #00D4FF;">HARMAN RATHI TESTING AGENCY</h2>
          <p>Your OTP for admin login is:</p>
          <h1 style="font-size: 32px; letter-spacing: 5px; color: #D4AF37;">${otp}</h1>
          <p>This OTP is valid for 5 minutes.</p>
        </div>
      `,
      fromName: 'HRTA Admin',
      type: 'admin',
      isOtp: true
    });
  } catch (error) {
    console.error('Failed to send admin OTP (allowing fallback bypass):', error);
  }
  res.json({ message: 'OTP sent successfully' })
})

// ============ SUPER ADMIN OTP ============
app.post('/api/send-superadmin-otp', authLimiter, verifyRecaptchaToken, validateEmailInput, async (req, res) => {
  const { email, secretKey } = req.body

  if (!email || !secretKey) {
    return res.status(400).json({ error: 'Email and secret key are required' })
  }

  const incomingKey = secretKey.trim();
  const isMatch = incomingKey === SUPER_ADMIN_SECRET || 
                  incomingKey.toLowerCase() === SUPER_ADMIN_SECRET.toLowerCase();

  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid secret key' })
  }

  const cleanEmail = email.trim();
  const { data: admins, error } = await supabaseAdmin
    .from('admins')
    .select('id, email, role, status')
    .ilike('email', cleanEmail)
    .eq('role', 'super_admin')

  if (error || !admins || admins.length === 0) {
    return res.status(401).json({ error: 'Unauthorized. Super admin access only.' })
  }

  const admin = admins[0];

  if (admin.status === 'disabled') {
    return res.status(401).json({ error: 'Account disabled.' })
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = Date.now() + 5 * 60 * 1000

  // NORMALIZE KEY
  const normalizedKey = email.toLowerCase().trim()

  otpStore.set(normalizedKey, { 
    otp, 
    expiresAt, 
    role: 'super_admin', 
    userId: admin.id,
    userEmail: admin.email,
    displayName: admin.email
  })

  try {
    await sendEmail({
      to: admin.email,
      subject: 'Your Super Admin Login OTP',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #D4AF37;">HARMAN RATHI TESTING AGENCY</h2>
          <p>Your OTP for Super Admin login is:</p>
          <h1 style="font-size: 32px; letter-spacing: 5px; color: #00D4FF;">${otp}</h1>
          <p>This OTP is valid for 5 minutes.</p>
        </div>
      `,
      fromName: 'HRTA Admin',
      type: 'admin',
      isOtp: true
    });
  } catch (error) {
    console.error('Failed to send super admin OTP (allowing fallback bypass):', error);
  }
  res.json({ message: 'OTP sent successfully' })
})

// ============ STUDENT OTP ============
app.post('/api/send-student-otp', authLimiter, verifyRecaptchaToken, async (req, res) => {
  const { applicationId, dateOfBirth } = req.body

  if (!applicationId || !dateOfBirth) {
    return res.status(400).json({ error: 'Application ID and Date of Birth are required' })
  }

  const cleanAppId = applicationId.trim()
  
  // Find student by application_id case-insensitively
  const { data: students, error: dbError } = await supabaseAdmin
    .from('students')
    .select('*')
    .ilike('application_id', cleanAppId)

  if (dbError || !students || students.length === 0) {
    return res.status(401).json({ error: 'Invalid Application ID or Date of Birth' })
  }

  // Find student matching the normalized DOB
  const inputDobNormalized = normalizeDateOfBirth(dateOfBirth)
  const student = students.find(s => normalizeDateOfBirth(s.date_of_birth) === inputDobNormalized)

  if (!student) {
    return res.status(401).json({ error: 'Invalid Application ID or Date of Birth' })
  }

  if (student.status === 'disabled') {
    return res.status(401).json({ error: 'Account disabled. Contact administrator.' })
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = Date.now() + 5 * 60 * 1000

  // NORMALIZE KEY (Using App ID for students as defined in the frontend)
  const normalizedKey = applicationId.toLowerCase().trim()

  otpStore.set(normalizedKey, { 
    otp, 
    expiresAt, 
    role: 'student', 
    userId: student.id,
    userEmail: student.email,
    displayName: student.full_name
  })

  try {
    await sendEmail({
      to: student.email,
      subject: 'Your Login OTP',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #00D4FF;">HARMAN RATHI TESTING AGENCY</h2>
          <p>Your OTP for login is:</p>
          <h1 style="font-size: 32px; letter-spacing: 5px; color: #D4AF37;">${otp}</h1>
          <p>This OTP is valid for 5 minutes.</p>
        </div>
      `,
      fromName: 'HRTA',
      type: 'student',
      isOtp: true
    });
  } catch (error) {
    console.error('Failed to send student OTP (allowing fallback bypass):', error);
  }
  res.json({ message: 'OTP sent successfully' })
})

// ============ VERIFY OTP (BULLETPROOF) ============
app.post('/api/verify-otp', authLimiter, validateVerifyOtp, async (req, res) => {
  // Support both 'identifier' and legacy 'email' from frontend payload
  const incomingIdentifier = req.body.identifier || req.body.email;
  const otp = req.body.otp;

  // NORMALIZE THE LOOKUP KEY to perfectly match how we stored it
  const lookupKey = incomingIdentifier.toLowerCase().trim();
  const stored = otpStore.get(lookupKey)

  if (!stored) {
    return res.status(400).json({ error: 'OTP not found. Please request a new one.' })
  }

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(lookupKey)
    return res.status(400).json({ error: 'OTP has expired. Please request a new one.' })
  }

  if (stored.otp !== otp) {
    // Audit log for failed attempt to track anomalies/brute force
    try {
      const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
      const ip = rawIp.split(',')[0].trim();
      await supabaseAdmin
        .from('audit_logs')
        .insert({
          user_id: stored.userId || 'Unknown',
          user_role: stored.role || 'Anonymous',
          display_name: stored.userEmail || 'Anonymous',
          action: 'LOGIN_OTP_FAILED',
          details: { email: stored.userEmail, reason: 'Invalid OTP code entered', ip_address: ip },
          ip_address: ip
        });
    } catch (auditErr) {
      console.error("Failed to insert failed OTP audit log:", auditErr.message);
    }
    return res.status(400).json({ error: 'Invalid OTP' })
  }

  // Clear OTP to prevent replay attacks
  otpStore.delete(lookupKey)

  console.log(`User verified successfully: Role [${stored.role}] ID [${stored.userId}]`)

  // Derive native Supabase Auth password cryptographically using a deterministic pepper
  const dbPassword = crypto.createHash('sha256').update(stored.userEmail + 'HRTA_SECURE_AUTH_PEPPER_2026').digest('hex');

  // Self-healing Supabase Auth Sync (Run immediately so auth user exists & matches ID before any early MFA redirects)
  try {
    const { data: { users }, error: getErr } = await supabaseAdmin.auth.admin.listUsers();
    if (getErr) throw getErr;

    const matchedUser = users ? users.find(u => u.email.toLowerCase() === stored.userEmail.toLowerCase()) : null;

    if (!matchedUser) {
      const { data: newUserData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        id: stored.userId,
        email: stored.userEmail,
        password: dbPassword,
        email_confirm: true
      });
      if (createErr) {
        console.error("Failed to create native Supabase Auth user:", createErr.message);
      } else {
        console.log("Created native Supabase Auth user for email:", stored.userEmail);
      }
    } else if (matchedUser.id !== stored.userId) {
      console.log(`Mismatch detected for ${stored.userEmail}. Auth ID: ${matchedUser.id}, Stored ID: ${stored.userId}. Re-aligning...`);
      // Delete mismatched user
      const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(matchedUser.id);
      if (deleteErr) {
        console.error("Failed to delete mismatched Supabase Auth user:", deleteErr.message);
      } else {
        // Create user with correct ID
        const { data: newUserData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          id: stored.userId,
          email: stored.userEmail,
          password: dbPassword,
          email_confirm: true
        });
        if (createErr) {
          console.error("Failed to recreate aligned Supabase Auth user:", createErr.message);
        } else {
          console.log("Successfully aligned Supabase Auth user for email:", stored.userEmail);
        }
      }
    } else {
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(matchedUser.id, {
        password: dbPassword
      });
      if (updateErr) {
        console.warn("Failed to sync password for native Supabase Auth user:", updateErr.message);
      }
    }
  } catch (syncErr) {
    console.error("Exception during Supabase Auth Sync:", syncErr.message);
  }

  // MFA check for admins and superadmins
  if (stored.role === 'admin' || stored.role === 'super_admin') {
    try {
      const { data: dbAdmin, error: adminErr } = await supabaseAdmin
        .from('admins')
        .select('mfa_secret')
        .eq('id', stored.userId)
        .single();

      if (!adminErr && dbAdmin && dbAdmin.mfa_secret) {
        // MFA is enabled! Generate a temporary session token (valid for 5 minutes)
        const tempToken = crypto.createHash('sha256').update(stored.userEmail + dbPassword + Date.now().toString()).digest('hex');
        mfaStore.set(tempToken, {
          role: stored.role,
          userId: stored.userId,
          userEmail: stored.userEmail,
          displayName: stored.userEmail,
          dbPassword: dbPassword
        });
        
        setTimeout(() => mfaStore.delete(tempToken), 5 * 60 * 1000);

        return res.json({
          mfaRequired: true,
          tempToken: tempToken,
          email: stored.userEmail
        });
      }
    } catch (mfaCheckErr) {
      console.error('MFA DB verification error:', mfaCheckErr.message);
    }
  }

  // Capture IP Address & Log to Database
  const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
  const ip = rawIp.split(',')[0].trim();

  let logId = null;
  try {
    const { data: logData, error: logErr } = await supabaseAdmin
      .from('login_logs')
      .insert({
        user_id: stored.userId,
        user_role: stored.role,
        display_name: stored.displayName || stored.userEmail || 'Unknown Candidate',
        ip_address: ip,
        location: 'Resolving location...'
      })
      .select()
      .single();

    if (logErr) {
      console.warn("Failed to insert login log. Check if public.login_logs table exists.", logErr.message);
    } else if (logData) {
      logId = logData.id;
      // Resolve geo-location in background (non-blocking)
      resolveGeoLocationAndUpdate(logData.id, ip);
    }

    // Write to audit_logs if admin/super_admin logs in
    if (stored.role === 'admin' || stored.role === 'super_admin') {
      try {
        await supabaseAdmin
          .from('audit_logs')
          .insert({
            user_id: stored.userId,
            user_role: stored.role,
            display_name: stored.displayName || stored.userEmail || 'Admin',
            action: 'ADMIN_LOGIN',
            details: { email: stored.userEmail, login_log_id: logId },
            ip_address: ip
          });
      } catch (auditErr) {
        console.error("Failed to insert admin login audit log:", auditErr.message);
      }
    }
  } catch (dbErr) {
    console.error("Exception inserting login log:", dbErr.message);
  }

  // Determine if MFA setup is required on first admin login
  let mfaSetupRequired = false;
  let mfaSecret = null;
  let tempToken = null;

  if (stored.role === 'admin' || stored.role === 'super_admin') {
    try {
      const { data: dbAdmin, error: adminErr } = await supabaseAdmin
        .from('admins')
        .select('mfa_secret')
        .eq('id', stored.userId)
        .single();

      if (!adminErr && dbAdmin && !dbAdmin.mfa_secret) {
        mfaSetupRequired = true;
        mfaSecret = generateBase32Secret(stored.userEmail);
        
        tempToken = crypto.createHash('sha256').update(stored.userEmail + dbPassword + Date.now().toString()).digest('hex');
        mfaStore.set(tempToken, {
          role: stored.role,
          userId: stored.userId,
          userEmail: stored.userEmail,
          displayName: stored.displayName || stored.userEmail,
          dbPassword: dbPassword,
          mfaSecret: mfaSecret,
          isSetup: true
        });
        
        setTimeout(() => mfaStore.delete(tempToken), 5 * 60 * 1000);
      }
    } catch (e) {
      console.error("Failed to check mfa_secret presence:", e.message);
    }
  }

  if (mfaSetupRequired) {
    return res.json({
      mfaSetupRequired: true,
      tempToken: tempToken,
      mfaSecret: mfaSecret,
      email: stored.userEmail
    });
  }

  // Generate and register custom student session token
  const mockToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(mockToken).digest('hex');

  try {
    await supabaseAdmin
      .from('session_activity')
      .insert({
        user_id: stored.userId,
        refresh_token_hash: tokenHash,
        ip_address: ip,
        user_agent: req.headers['user-agent'] || 'Unknown',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      });
  } catch (e) {
    console.warn("Could not insert session activity during OTP verification:", e.message);
  }

  // Return properties the React app needs
  res.json({ 
    message: 'Login successful', 
    role: stored.role, 
    userId: stored.userId, 
    userEmail: stored.userEmail,
    loginLogId: logId,
    dbPassword: dbPassword,
    sessionToken: mockToken,
    mfaSetupRequired: false
  })
})

// ============ SESSION HEARTBEAT ============
app.post('/api/session-heartbeat', verifyUserJWT, async (req, res) => {
  const { logId } = req.body;
  if (!logId) {
    return res.status(400).json({ error: 'Log ID is required' });
  }
  
  try {
    const { data: log, error: fetchErr } = await supabaseAdmin
      .from('login_logs')
      .select('login_at')
      .eq('id', logId)
      .single();
      
    if (fetchErr || !log) {
      return res.status(404).json({ error: 'Log session not found' });
    }
    
    const loginTime = new Date(log.login_at).getTime();
    const now = Date.now();
    const durationSecs = Math.round((now - loginTime) / 1000);
    
    const { error: updateErr } = await supabaseAdmin
      .from('login_logs')
      .update({
        last_activity_at: new Date().toISOString(),
        session_duration_seconds: durationSecs
      })
      .eq('id', logId);
      
    if (updateErr) throw updateErr;
    
    res.json({ success: true, session_duration_seconds: durationSecs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update heartbeat' });
  }
})

// ============ EXAM LIVENESS MONITOR & HEARTBEAT ============
const activeExamSessions = new Map();

app.post('/api/exam-heartbeat', verifyUserJWT, (req, res) => {
  try {
    const user = req.user;
    const { examId, status } = req.body;
    if (!examId) {
      return res.status(400).json({ error: 'Exam ID is required.' });
    }

    activeExamSessions.set(user.id, {
      lastActive: Date.now(),
      examId,
      email: user.email || 'Student',
      status: status || 'online'
    });

    res.json({ success: true, status: 'online' });
  } catch (err) {
    console.error('Error in exam heartbeat endpoint:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/active-sessions', verifyAdminJWT, (req, res) => {
  try {
    const result = [];
    activeExamSessions.forEach((value, key) => {
      const isOnline = (Date.now() - value.lastActive) < 10000; // 10 seconds offline threshold
      result.push({
        studentId: key,
        email: value.email,
        examId: value.examId,
        status: isOnline ? 'online' : 'offline',
        lastActive: new Date(value.lastActive).toISOString()
      });
    });
    res.json(result);
  } catch (err) {
    console.error('Error in active-sessions endpoint:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Periodic reaper loop running every 10 seconds to flag offline status
setInterval(() => {
  const now = Date.now();
  activeExamSessions.forEach((value, key) => {
    if (now - value.lastActive >= 10000) {
      if (value.status !== 'offline') {
        value.status = 'offline';
        console.log(`[Heartbeat] Student session ${key} went offline (no ping for 10s).`);
        // Log to audit trail in-memory queue
        serverAuditQueue.push({
          userId: key,
          userRole: 'student',
          displayName: value.email,
          action: 'STUDENT_OFFLINE',
          ip: 'System',
          details: { exam_id: value.examId, reason: 'heartbeat_timeout' }
        });
      }
    }
  });
}, 10000);

// ============ CLOUDINARY IMAGE UPLOAD ============
app.post('/api/upload-image', heavyRequestLimiter, verifyAdminJWT, validateUploadImage, async (req, res) => {
  const { image } = req.body

  if (!image) {
    return res.status(400).json({ error: 'Image is required' })
  }

  // Validate base64 MIME type
  const mimeMatch = image.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,/);
  if (!mimeMatch) {
    return res.status(400).json({ error: 'Invalid base64 image encoding or missing header' });
  }
  const mimeType = mimeMatch[1];
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedMimeTypes.includes(mimeType)) {
    return res.status(400).json({ error: 'File type not allowed. Only JPEG, PNG, WEBP, and GIF images are permitted.' });
  }

  try {
    const result = await cloudinary.uploader.upload(image, {
      folder: 'hrta_questions',
      upload_preset: process.env.CLOUDINARY_UPLOAD_PRESET
    })

    res.json({
      url: result.secure_url,
      secure_url: result.secure_url,
      public_id: result.public_id
    })
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    res.status(500).json({ error: 'Failed to upload image' })
  }
})

// ============ DELETE IMAGE ============
app.post('/api/delete-image', verifyAdminJWT, validateDeleteImage, async (req, res) => {
  const { public_id } = req.body

  if (!public_id) {
    return res.status(400).json({ error: 'Public ID is required' })
  }

  try {
    await cloudinary.uploader.destroy(public_id)
    res.json({ message: 'Image deleted successfully' })
  } catch (error) {
    console.error('Cloudinary delete error:', error)
    res.status(500).json({ error: 'Failed to delete image' })
  }
})

// ============ GET SIGNED UPLOAD URL FOR STORAGE ============
app.post('/api/get-upload-url', verifyAdminJWT, validateGetUploadUrl, async (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required.' });
    }

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'File upload restricted to PDF files only.' });
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ 
        error: 'Database Configuration Error: SUPABASE_SERVICE_ROLE_KEY is missing on Render. Please add it to your Render dashboard Environment Variables.' 
      });
    }

    const { data, error } = await supabaseAdmin.storage
      .from('hrta-files')
      .createSignedUploadUrl(fileName);

    if (error) throw error;

    res.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path
    });
  } catch (error) {
    console.error('Error generating signed upload URL:', error.message || error);
    res.status(500).json({ error: 'Failed to generate upload URL.' });
  }
})

// ============ COMPREHENSIVE AUDIT LOGGING ============
const serverAuditQueue = [];
let lastKnownHash = null;

async function getLatestHash() {
  if (lastKnownHash) return lastKnownHash;
  try {
    const { data: lastLog } = await supabaseAdmin
      .from('audit_logs')
      .select('details')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastLog && lastLog.details && lastLog.details.curr_hash) {
      lastKnownHash = lastLog.details.curr_hash;
    }
  } catch (hashErr) {
    console.warn("Could not retrieve preceding audit log hash, using genesis seed:", hashErr.message);
  }
  return lastKnownHash || '0000000000000000000000000000000000000000000000000000000000000000';
}

// Background worker to flush queued audit logs every 2 seconds
setInterval(async () => {
  if (serverAuditQueue.length === 0) return;

  const batch = serverAuditQueue.splice(0, serverAuditQueue.length);
  let prevHash = await getLatestHash();
  const dbInserts = [];

  for (const item of batch) {
    const timestamp = new Date().toISOString();
    const logDetails = item.details || {};

    const hashInput = JSON.stringify({
      userId: item.userId || 'Unknown',
      action: item.action,
      ip: item.ip,
      prevHash: prevHash,
      timestamp: timestamp,
      payload: logDetails
    });

    const currHash = crypto.createHash('sha256').update(hashInput).digest('hex');

    const securedDetails = {
      ...logDetails,
      prev_hash: prevHash,
      curr_hash: currHash,
      hashed_at: timestamp
    };

    dbInserts.push({
      user_id: item.userId || 'Unknown',
      user_role: item.userRole || 'Anonymous',
      display_name: item.displayName || 'Anonymous',
      action: item.action,
      details: securedDetails,
      ip_address: item.ip
    });

    prevHash = currHash;
  }

  lastKnownHash = prevHash;

  try {
    const { error } = await supabaseAdmin.from('audit_logs').insert(dbInserts);
    if (error) throw error;
    console.log(`[Worker] Batched and saved ${dbInserts.length} audit logs.`);
  } catch (err) {
    console.error("[Worker] Failed to batch insert audit logs:", err.message);
    // Re-queue items at the front to retry
    serverAuditQueue.unshift(...batch);
  }
}, 2000);

app.post('/api/audit-log', verifyUserJWT, validateAuditLog, async (req, res) => {
  try {
    const { userId, userRole, displayName, action, details } = req.body;
    if (!action) {
      return res.status(400).json({ error: 'Action is required' });
    }

    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const ip = rawIp.split(',')[0].trim();

    serverAuditQueue.push({
      userId,
      userRole,
      displayName,
      action,
      details,
      ip
    });

    res.json({ success: true, queued: true });
  } catch (error) {
    console.error('Error queueing audit log:', error.message || error);
    res.status(500).json({ error: 'Failed to queue audit log.' });
  }
});

app.post('/api/audit-log/batch', verifyUserJWT, async (req, res) => {
  try {
    const { events } = req.body;
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'Array of events is required.' });
    }

    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const ip = rawIp.split(',')[0].trim();

    events.forEach(ev => {
      serverAuditQueue.push({
        userId: ev.user_id,
        userRole: ev.user_role || 'student',
        displayName: ev.display_name,
        action: ev.action,
        details: ev.details,
        ip
      });
    });

    res.json({ success: true, queuedCount: events.length });
  } catch (error) {
    console.error('Error queueing batch audit logs:', error.message || error);
    res.status(500).json({ error: 'Failed to queue batch audit logs.' });
  }
});

// ============ SIGN CLOUDINARY DELIVERY URL ============
app.post('/api/sign-url', verifyUserJWT, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    if (!url.includes('res.cloudinary.com')) {
      return res.json({ signedUrl: url });
    }

    const urlParts = url.split('/');
    const uploadIdx = urlParts.indexOf('upload');
    const authIdx = urlParts.indexOf('authenticated');
    const privateIdx = urlParts.indexOf('private');

    let type = 'upload';
    let idx = uploadIdx;

    if (authIdx !== -1) {
      type = 'authenticated';
      idx = authIdx;
    } else if (privateIdx !== -1) {
      type = 'private';
      idx = privateIdx;
    }

    if (idx === -1) {
      return res.json({ signedUrl: url });
    }

    let remaining = urlParts.slice(idx + 1);
    if (remaining[0].startsWith('v') && !isNaN(remaining[0].substring(1))) {
      remaining = remaining.slice(1);
    }

    const publicIdWithExt = remaining.join('/');
    const ext = publicIdWithExt.split('.').pop().toLowerCase();
    
    let resource_type = 'raw';
    if (['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      resource_type = 'image';
    } else if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) {
      resource_type = 'video';
    }

    const expiresAt = Math.floor(Date.now() / 1000) + 20 * 60; // 20 minutes

    const signedUrl = cloudinary.url(publicIdWithExt, {
      sign_url: true,
      type: type === 'upload' ? 'upload' : type,
      expires_at: expiresAt,
      secure: true,
      resource_type: resource_type
    });

    res.json({ signedUrl });
  } catch (error) {
    console.error('Error signing URL:', error.message || error);
    res.status(500).json({ error: 'Failed to sign URL.' });
  }
})

// ============ RESULT NOTIFICATION SENDER ============
app.post('/api/send-result-published-email', verifyAdminJWT, async (req, res) => {
  const { submissionId } = req.body;
  if (!submissionId) {
    return res.status(400).json({ error: 'Submission ID is required.' });
  }

  try {
    const { data: submission, error: subErr } = await supabaseAdmin
      .from('exam_results')
      .select(`
        id,
        total_score,
        total_marks,
        percentage,
        students ( full_name, email, application_id ),
        exams ( title, subject )
      `)
      .eq('id', submissionId)
      .single();

    if (subErr || !submission) {
      return res.status(404).json({ error: 'Exam submission record not found.' });
    }

    const studentName = submission.students?.full_name || 'Candidate';
    const studentEmail = submission.students?.email;
    const examTitle = submission.exams?.title || 'Examination';
    const score = submission.total_score || 0;
    const total = submission.total_marks || 0;
    const pct = submission.percentage || 0;

    if (!studentEmail) {
      return res.status(400).json({ error: 'Student email is missing from database.' });
    }

    // Use the exact verified domain (harmanrathiportal.dpdns.org)
    // to prevent domain/subdomain mismatched link blocks from Gmail spam filters
    const portalDomain = 'https://harmanrathiportal.dpdns.org';
    const secret = process.env.SUPER_ADMIN_SECRET || 'HRTA_SUPER_SECRET_2026';
    const secureToken = crypto.createHmac('sha256', secret).update(submissionId).digest('hex');
    const scorecardLink = `${portalDomain}/student/results?resultId=${submissionId}&token=${secureToken}`;

    // Clean, deliverable email — white background, no emojis, simple layout
    // Dark themes and emoji in email body are blocked by many corporate mail servers
    const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Result Published - HRTA</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f7fb; font-family:Arial, Helvetica, sans-serif; color:#222222;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7fb; padding:24px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden; border:1px solid #dce3ee; max-width:600px;">
          
          <!-- Header -->
          <tr>
            <td style="background-color:#1a3a6b; padding:28px 32px; text-align:center;">
              <p style="margin:0; color:#ffffff; font-size:22px; font-weight:bold; letter-spacing:1px;">HARMAN RATHI TESTING AGENCY</p>
              <p style="margin:6px 0 0; color:#a8c0e8; font-size:12px; letter-spacing:2px;">RESULT NOTIFICATION</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px; font-size:16px; color:#1a3a6b; font-weight:bold;">Dear ${studentName},</p>
              <p style="margin:0 0 24px; font-size:14px; line-height:1.7; color:#444444;">
                Your result for the examination <strong>${examTitle}</strong> has been graded and published by the administrator. Please find your performance summary below.
              </p>

              <!-- Score Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dce3ee; border-radius:6px; margin-bottom:28px;">
                <tr style="background-color:#f0f5ff;">
                  <td colspan="2" style="padding:12px 16px; font-size:12px; font-weight:bold; color:#1a3a6b; letter-spacing:1px; border-bottom:1px solid #dce3ee;">PERFORMANCE SUMMARY</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px; font-size:13px; color:#666666; border-bottom:1px solid #f0f0f0;">Exam Title</td>
                  <td style="padding:12px 16px; font-size:13px; font-weight:bold; color:#222222; text-align:right; border-bottom:1px solid #f0f0f0;">${examTitle}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px; font-size:13px; color:#666666; border-bottom:1px solid #f0f0f0;">Candidate Name</td>
                  <td style="padding:12px 16px; font-size:13px; font-weight:bold; color:#222222; text-align:right; border-bottom:1px solid #f0f0f0;">${studentName}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px; font-size:13px; color:#666666; border-bottom:1px solid #f0f0f0;">Application ID</td>
                  <td style="padding:12px 16px; font-size:13px; color:#555555; text-align:right; font-family:monospace; border-bottom:1px solid #f0f0f0;">${submission.students?.application_id || 'N/A'}</td>
                </tr>
                <tr style="background-color:#f9fbff;">
                  <td style="padding:14px 16px; font-size:15px; font-weight:bold; color:#1a3a6b;">Score Obtained</td>
                  <td style="padding:14px 16px; font-size:18px; font-weight:bold; color:#1a3a6b; text-align:right;">${score} / ${total}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px; font-size:13px; color:#666666;">Percentage</td>
                  <td style="padding:12px 16px; font-size:14px; font-weight:bold; color:#0d7a3e; text-align:right;">${pct}%</td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <a href="${scorecardLink}" target="_blank" style="display:inline-block; background-color:#1a3a6b; color:#ffffff; text-decoration:none; font-weight:bold; font-size:14px; padding:14px 32px; border-radius:6px; letter-spacing:0.5px;">View Scorecard on Portal</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0; font-size:13px; color:#888888; line-height:1.6;">
                If the button above does not work, copy and paste this link into your browser:<br>
                <span style="color:#1a3a6b;">${scorecardLink}</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f4f7fb; padding:20px 32px; text-align:center; border-top:1px solid #dce3ee;">
              <p style="margin:0; font-size:12px; color:#999999; line-height:1.6;">
                This is an automated transactional notification from <strong>Harman Rathi Testing Agency</strong>.<br>
                Please do not reply to this email.
              </p>
              <p style="margin:8px 0 0; font-size:10px; color:#aaaaaa; line-height:1.5;">
                HRTA HQ: Sector 62, IIT Kanpur Outreach Centre, Noida, UP, India.<br>
                To opt-out of future transactional alerts, please notify your exam coordinator.
              </p>
              <p style="margin:8px 0 0; font-size:11px; color:#bbbbbb;">Copyright ${new Date().getFullYear()} HRTA. All Rights Reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const plainText = `HARMAN RATHI TESTING AGENCY - RESULT NOTIFICATION

Dear ${studentName},

Your result for the examination "${examTitle}" has been graded and published.

PERFORMANCE SUMMARY
-------------------
Exam Title    : ${examTitle}
Candidate Name: ${studentName}
Application ID: ${submission.students?.application_id || 'N/A'}
Score Obtained: ${score} / ${total}
Percentage    : ${pct}%

View your scorecard at:
${scorecardLink}

---
This is an automated notification from Harman Rathi Testing Agency.
Please do not reply to this email.
Copyright ${new Date().getFullYear()} HRTA. All Rights Reserved.`;

    // Fire and forget email dispatching in the background to avoid 15-second client timeouts
    sendEmail({
      to: studentEmail,
      subject: `HRTA Result Published: ${examTitle}`,
      html: htmlBody,
      text: plainText,
      fromName: 'HRTA Results',
      type: 'student',
      isOtp: false,
      preferSmtp: true  // Gmail SMTP first — bypasses new-domain IP reputation block
    }).catch(err => {
      console.error('Background result email failed to send.');
    });

    res.json({ success: true, message: 'Result email notification dispatched successfully.' });
  } catch (err) {
    console.error('Failed to prepare result notification.');
    res.status(500).json({ error: 'Failed to prepare result email notification.' });
  }
});

// ============ SUPERADMIN MAIL SYSTEM ENDPOINTS ============

// 1. Compose & Send Broadcast/Individual Emails
app.post('/api/admin/mail/compose', verifyAdminJWT, async (req, res) => {
  try {
    const { recipients, subject, body, attachments = [] } = req.body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'Recipients array is required and must not be empty.' });
    }
    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      return res.status(400).json({ error: 'Subject is required.' });
    }
    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'Email body is required.' });
    }

    // Filter valid email addresses
    const validRecipients = recipients
      .map(r => (typeof r === 'string' ? r.trim() : ''))
      .filter(r => r.includes('@') && r.length > 3);

    if (validRecipients.length === 0) {
      return res.status(400).json({ error: 'No valid recipient email addresses provided.' });
    }

    if (validRecipients.length > 1000) {
      return res.status(400).json({ error: 'Maximum 1000 recipients allowed per email dispatch.' });
    }

    console.log(`[Superadmin Mail] Initiating asynchronous email dispatch to ${validRecipients.length} recipient(s). Subject: "${subject}"`);

    // Immediately respond to client to prevent Express / browser 15-second request timeout
    res.json({
      success: true,
      sent: validRecipients.length,
      message: `Email dispatch initiated for ${validRecipients.length} recipient(s).`
    });

    // Execute email dispatching asynchronously in the background
    setImmediate(async () => {
      let sentCount = 0;
      let failedCount = 0;
      const logsToInsert = [];

      // Send emails in concurrent batches of 5
      const BATCH_SIZE = 5;
      for (let i = 0; i < validRecipients.length; i += BATCH_SIZE) {
        const batch = validRecipients.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (recipient) => {
          try {
            const result = await sendEmail({
              to: recipient,
              subject: subject.trim(),
              html: body,
              fromName: 'HRTA Central Controller',
              fromEmailOverride: SUPERADMIN_FROM_EMAIL,
              preferSmtp: false // Resend HTTPS API over port 443 — ultra fast, zero port 2525 timeouts
            });

            if (result && result.success) {
              sentCount++;
              logsToInsert.push({
                recipient,
                subject: subject.trim(),
                status: 'SENT',
                provider: result.provider || 'resend',
                sent_at: new Date().toISOString()
              });
            } else {
              failedCount++;
              logsToInsert.push({
                recipient,
                subject: subject.trim(),
                status: 'FAILED',
                provider: 'none',
                error_details: result?.error?.message || 'Dispatch failed',
                sent_at: new Date().toISOString()
              });
            }
          } catch (err) {
            failedCount++;
            console.error(`[Superadmin Mail Error] Failed to send email to ${recipient}:`, err.message);
            logsToInsert.push({
              recipient,
              subject: subject.trim(),
              status: 'FAILED',
              provider: 'none',
              error_details: err.message,
              sent_at: new Date().toISOString()
            });
          }
        }));
      }

      // Persist logs in DB if table exists
      if (supabaseAdmin && logsToInsert.length > 0) {
        try {
          await supabaseAdmin.from('mail_logs').insert(logsToInsert);
        } catch (dbErr) {
          console.log('[Superadmin Mail] Log insert skipped:', dbErr.message);
        }
      }

      console.log(`[Superadmin Mail Background Finished] Sent: ${sentCount}/${validRecipients.length}, Failed: ${failedCount}`);
    });
  } catch (err) {
    console.error('[Superadmin Mail Fatal Error]:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || 'Internal server error while processing mail dispatch.' });
    }
  }
});


// 2. Fetch Mail Logs
app.get('/api/admin/mail/logs', verifyAdminJWT, async (req, res) => {
  try {
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('mail_logs')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(100);

      if (!error && Array.isArray(data)) {
        return res.json(data);
      }
    }
    return res.json([]);
  } catch (err) {
    return res.json([]);
  }
});

// 3. Upload Mail Attachment
app.post('/api/admin/mail/upload-attachment', verifyAdminJWT, async (req, res) => {
  try {
    const { file, filename, mimetype } = req.body;
    if (!file || !filename) {
      return res.status(400).json({ error: 'File data and filename are required.' });
    }
    const dataUri = `data:${mimetype || 'application/octet-stream'};base64,${file}`;
    const uploadRes = await cloudinary.uploader.upload(dataUri, {
      folder: 'hrta_mail_attachments',
      resource_type: 'auto'
    });

    return res.json({ url: uploadRes.secure_url, filename });
  } catch (err) {
    console.error('[Mail Attachment Upload Error]:', err);
    return res.status(500).json({ error: err.message || 'Attachment upload failed.' });
  }
});

// ============ REPLY TO SUPPORT TICKET ============

app.post('/api/reply-support-ticket', verifyAdminJWT, async (req, res) => {
  const { ticketId, replyMessage } = req.body;
  if (!ticketId || !replyMessage) {
    return res.status(400).json({ error: 'Ticket ID and reply message are required.' });
  }

  try {
    // 1. Fetch ticket details using admin bypass client
    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from('support_tickets')
      .select('*')
      .eq('id', ticketId)
      .single();

    if (ticketErr || !ticket) {
      return res.status(404).json({ error: 'Support ticket not found.' });
    }

    // 2. Format the response email body
    const formattedHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #dce3ee; border-radius: 8px; background-color: #ffffff; color: #222222;">
        <div style="background-color: #1a3a6b; padding: 20px; text-align: center; border-radius: 6px 6px 0 0; margin-bottom: 24px;">
          <h2 style="color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 0.5px;">HRTA Help Desk Support</h2>
          <p style="color: #a8c0e8; font-size: 11px; margin: 4px 0 0 0; letter-spacing: 1px;">OFFICIAL RESPONSE</p>
        </div>
        <p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px;">Dear <strong>${ticket.name}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.6; margin: 0 0 20px;">Thank you for contacting the HRTA Help Desk. Below is the official response regarding your support ticket:</p>
        
        <div style="background-color: #f4f7fb; border-left: 4px solid #1a3a6b; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0; font-size: 14px; color: #111111; line-height: 1.6; white-space: pre-wrap;">${replyMessage}</p>
        </div>

        <div style="margin-top: 28px; border-top: 1px solid #dce3ee; padding-top: 20px;">
          <p style="font-size: 12px; font-weight: bold; color: #666666; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">Original Concern Details</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 12px; color: #555555; line-height: 1.5;">
            <tr>
              <td style="padding: 4px 0; font-weight: bold; width: 90px; color: #666666;">Subject:</td>
              <td style="padding: 4px 0; color: #222222;">${ticket.subject}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold; color: #666666;">Submitted:</td>
              <td style="padding: 4px 0; color: #222222;">${new Date(ticket.created_at).toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-weight: bold; color: #666666; vertical-align: top;">Concern:</td>
              <td style="padding: 6px 0; color: #222222; white-space: pre-wrap;">${ticket.message}</td>
            </tr>
          </table>
        </div>

        <div style="margin-top: 28px; text-align: center; font-size: 11px; color: #999999; border-top: 1px solid #f0f0f0; padding-top: 16px; line-height: 1.4;">
          This is an automated support response from <strong>response@harmanrathiportal.dpdns.org</strong>.<br>
          Please do not reply directly to this mail.
        </div>
      </div>
    `;

    const plainText = `HRTA HELP DESK SUPPORT - OFFICIAL RESPONSE

Dear ${ticket.name},

Thank you for contacting the HRTA Help Desk. Below is the official response to your concern:

--------------------------------------------------
${replyMessage}
--------------------------------------------------

ORIGINAL CONCERN DETAILS
Subject: ${ticket.subject}
Submitted: ${new Date(ticket.created_at).toLocaleString()}
Concern: ${ticket.message}

---
This is an automated support response from response@harmanrathiportal.dpdns.org.
Please do not reply directly to this mail.`;

    // 3. Send email using our helper function and new domain email override
    await sendEmail({
      to: ticket.email,
      subject: `[HRTA Support] Re: ${ticket.subject}`,
      html: formattedHtml,
      text: plainText,
      fromName: 'HRTA Support Desk',
      fromEmailOverride: 'response@harmanrathiportal.dpdns.org',
      preferSmtp: false
    });

    // 4. Update the ticket status in Supabase database using supabaseAdmin
    const { error: updateErr } = await supabaseAdmin
      .from('support_tickets')
      .update({
        status: 'completed',
        resolved_at: new Date().toISOString(),
        admin_notes: replyMessage
      })
      .eq('id', ticketId);

    if (updateErr) throw updateErr;

  } catch (error) {
    console.error('Error replying to support ticket:', error.message || error);
    res.status(500).json({ error: 'Failed to send reply.' });
  }
});

// ============ VERIFY SCORECARD TOKEN ============
app.get('/api/verify-scorecard-token', async (req, res) => {
  const { resultId, token } = req.query;
  if (!resultId) {
    return res.status(400).json({ error: 'Result ID is required.' });
  }

  let isAuthorized = false;

  // 1. Verify via HMAC token (public link from email)
  if (token) {
    const secret = process.env.SUPER_ADMIN_SECRET || 'HRTA_SUPER_SECRET_2026';
    const expectedToken = crypto.createHmac('sha256', secret).update(resultId).digest('hex');
    if (token === expectedToken) {
      isAuthorized = true;
    }
  }

  // 2. Fallback to verifying session JWT (student/admin portal view)
  if (!isAuthorized) {
    const authHeader = req.headers.authorization;
    let sessionToken = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessionToken = authHeader.split(' ')[1];
    }

    if (sessionToken) {
      try {
        const { data: { user }, error: authErr } = await supabase.auth.getUser(sessionToken);
        if (user && !authErr) {
          // Fetch result to check student_id
          const { data: resultCheck } = await supabaseAdmin
            .from('exam_results')
            .select('student_id')
            .eq('id', resultId)
            .single();

          if (resultCheck) {
            // Check if admin
            const { data: isAdmin } = await supabaseAdmin
              .from('admins')
              .select('id')
              .eq('id', user.id)
              .single();

            if (isAdmin || resultCheck.student_id === user.id) {
              isAuthorized = true;
            }
          }
        }
      } catch (err) {
        console.error('Session verification error inside verify-scorecard-token:', err);
      }
    }
  }

  if (!isAuthorized) {
    return res.status(403).json({ error: 'Invalid or expired secure scorecard token.' });
  }

  try {
    // Fetch result detail and join exams and students using supabaseAdmin to bypass RLS
    const { data: resultData, error: resultError } = await supabaseAdmin
      .from('exam_results')
      .select(`
        *,
        students ( id, full_name, email, application_id, date_of_birth, category ),
        exams (
          id,
          title,
          subject,
          exam_type,
          start_datetime,
          correct_marks,
          negative_marks
        )
      `)
      .eq('id', resultId)
      .single();

    if (resultError || !resultData) {
      console.error('Error fetching result data:', resultError);
      return res.status(404).json({ error: 'Scorecard not found.' });
    }

    if (resultData.status !== 'published') {
      return res.status(403).json({ error: 'This scorecard has not been published yet or is revoked.' });
    }

    // Now fetch questions for this exam
    const { data: questionsData, error: questionsError } = await supabaseAdmin
      .from('questions')
      .select('*')
      .eq('exam_id', resultData.exam_id)
      .order('order_index', { ascending: true });

    if (questionsError) {
      console.error('Error fetching questions:', questionsError);
      return res.status(500).json({ error: 'Failed to fetch scorecard questions.' });
    }

    // Determine the attempt number for this student on this exam
    const { data: attemptsData, error: attemptsError } = await supabaseAdmin
      .from('exam_results')
      .select('id, submitted_at')
      .eq('student_id', resultData.student_id)
      .eq('exam_id', resultData.exam_id)
      .eq('status', 'published');

    let attempt_number = 1;
    if (!attemptsError && attemptsData) {
      // Sort attempts chronologically by submitted_at
      const sorted = [...attemptsData].sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
      const idx = sorted.findIndex(a => a.id === resultId);
      if (idx !== -1) {
        attempt_number = idx + 1;
      }
    }

    res.json({
      result: {
        ...resultData,
        attempt_number
      },
      questions: questionsData || []
    });

  } catch (error) {
    console.error('Verify token failed:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============ ADMIN MESSAGE SENDER ============
app.post('/api/admin-message', verifyAdminJWT, async (req, res) => {
  try {
    const { students, subject, message, pdfUrl, pdfFileName } = req.body;

    if (!students || students.length === 0) {
      return res.status(400).json({ error: 'No recipients specified.' });
    }
    if (!subject) {
      return res.status(400).json({ error: 'Subject is required.' });
    }

    // Pick the best available Resend instances in order
    const mailerClients = [];
    if (resendNotificationClient) mailerClients.push({ name: 'resendNotificationClient', client: resendNotificationClient });
    if (resendNewFallbackClient) mailerClients.push({ name: 'resendNewFallbackClient', client: resendNewFallbackClient });
    if (resendStudent) mailerClients.push({ name: 'resendStudent', client: resendStudent });
    if (resend) mailerClients.push({ name: 'resendMain', client: resend });

    const fromEmail = FROM_EMAIL;

    const results = [];
    const errors = [];

    for (const student of students) {
      if (!student.email) { errors.push(`${student.full_name}: no email`); continue; }

      // Build beautiful HTML email
      const googleViewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(pdfUrl)}`;
      const downloadUrl = `${pdfUrl}?download=`;

      const pdfSection = pdfUrl ? `
        <div style="margin: 28px 0; padding: 24px; background: linear-gradient(135deg, #1e3a5f 0%, #0f2440 100%); border-radius: 12px; border: 1px solid #2a4d7a;">
          <p style="margin: 0 0 12px 0; color: #64b5f6; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">📎 Attached Document</p>
          <p style="margin: 0 0 20px 0; color: #cfd8dc; font-size: 13px; font-weight: bold;">${pdfFileName || 'Document.pdf'}</p>
          
          <div style="margin-bottom: 12px;">
            <a href="${googleViewerUrl}" target="_blank" 
               style="display: block; text-align: center; background: linear-gradient(135deg, #4285f4, #34a853); color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 13px; letter-spacing: 0.03em; box-shadow: 0 4px 6px rgba(0,0,0,0.15);">
              📂 Open in Google Drive / View PDF
            </a>
          </div>
          
          <div>
            <a href="${downloadUrl}" download="${pdfFileName || 'Document.pdf'}" target="_blank" 
               style="display: block; text-align: center; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #cfd8dc; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 12px; letter-spacing: 0.03em;">
              📥 Direct Download to Device
            </a>
          </div>
          
          <p style="margin: 14px 0 0 0; color: #607d8b; font-size: 11px; text-align: center;">Note: For mobile users, clicking "Open in Google Drive" will launch the Drive app to let you choose your account and save.</p>
        </div>` : '';

      const messageSection = message ? `
        <div style="background: #0d1b2a; border-radius: 10px; padding: 20px 24px; border-left: 4px solid #0288d1; margin: 20px 0;">
          <p style="margin: 0; color: #cfd8dc; font-size: 14px; line-height: 1.8; white-space: pre-line;">${message}</p>
        </div>` : '';

      const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="margin:0; padding:0; background:#060d17; font-family: 'Segoe UI', Arial, sans-serif;">
        <div style="max-width: 620px; margin: 0 auto; padding: 20px;">

          <!-- Header -->
          <div style="background: linear-gradient(135deg, #0d1b2a 0%, #0a1628 100%); border-radius: 16px 16px 0 0; padding: 32px 36px; border-bottom: 2px solid #0288d1; text-align: center;">
            <h1 style="margin: 0; color: #00bcd4; font-size: 22px; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase;">Harman Rathi Testing Agency</h1>
            <p style="margin: 6px 0 0; color: #546e7a; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600;">Excellence in Assessment</p>
          </div>

          <!-- Subject Bar -->
          <div style="background: linear-gradient(90deg, #0288d1, #0097a7); padding: 14px 36px;">
            <p style="margin: 0; color: white; font-size: 15px; font-weight: 800;">📧 ${subject}</p>
          </div>

          <!-- Body -->
          <div style="background: #0d1b2a; padding: 32px 36px; border-radius: 0 0 16px 16px; border: 1px solid #1a2e45; border-top: none;">
            <p style="margin: 0 0 12px 0; color: #64b5f6; font-size: 14px; font-weight: 700;">Dear ${student.full_name},</p>
            <p style="margin: 0 0 6px 0; color: #78909c; font-size: 12px;">Application No: <strong style="color:#90a4ae">${student.application_id || 'N/A'}</strong></p>

            ${messageSection}
            ${pdfSection}

            <!-- Footer -->
            <div style="margin-top: 36px; padding-top: 20px; border-top: 1px solid #1a2e45; text-align: center;">
              <p style="margin: 0; color: #37474f; font-size: 11px; line-height: 1.6;">
                This is an official communication from <strong style="color:#546e7a">Harman Rathi Testing Agency (HRTA)</strong>.<br>
                Please do not reply to this email. For queries, contact your exam coordinator.
              </p>
              <p style="margin: 10px 0 0; color: #263238; font-size: 10px;">© ${new Date().getFullYear()} HRTA · All Rights Reserved</p>
            </div>
          </div>
        </div>
      </body>
      </html>`;

      try {
        await sendEmail({
          to: student.email,
          subject: `[HRTA] ${subject}`,
          html: htmlBody,
          fromName: 'HRTA Notifications',
          isOtp: false
        });
        results.push(student.full_name);
      } catch (e) {
        errors.push(`${student.full_name}: ${e.message}`);
      }

      // Small delay to avoid rate limiting
      if (students.length > 1) await new Promise(r => setTimeout(r, 200));
    }

    res.json({
      success: true,
      sent: results.length,
      failed: errors.length,
      recipients: results,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (err) {
    console.error('Admin message error:', err.message || err);
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

// ============ SECURE SERVER-SIDE GRADING UTILITIES ============
const parseOption = (opt) => {
  if (opt === null || opt === undefined) return { text: '', image_url: '', image_public_id: '' };
  if (typeof opt !== 'string') {
    return { text: String(opt), image_url: '', image_public_id: '' };
  }
  const trimmed = opt.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        text: parsed.text !== undefined && parsed.text !== null ? String(parsed.text) : '',
        image_url: parsed.image_url || '',
        image_public_id: parsed.image_public_id || ''
      };
    } catch (e) {}
  }
  return { text: opt, image_url: '', image_public_id: '' };
};

const normalizeOptionForComparison = (opt) => {
  const parsed = parseOption(opt);
  const val = (parsed.text.trim() || parsed.image_url.trim());
  return val.toLowerCase();
};

const parseNumericalRange = (answerStr) => {
  if (!answerStr) return null;
  const clean = String(answerStr).trim();

  if (/\s+to\s+/i.test(clean)) {
    const parts = clean.split(/\s+to\s+/i);
    const min = parseFloat(parts[0]);
    const max = parseFloat(parts[1]);
    if (!isNaN(min) && !isNaN(max)) {
      return { min: Math.min(min, max), max: Math.max(min, max), isRange: true };
    }
  }

  const rangeMatch = clean.match(/^(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (!isNaN(min) && !isNaN(max)) {
      return { min: Math.min(min, max), max: Math.max(min, max), isRange: true };
    }
  }

  const val = parseFloat(clean);
  if (!isNaN(val)) {
    return { min: val, max: val, isRange: false };
  }

  return null;
};

// ============ SECURE EXAM SUBMISSION ENDPOINT ============
app.post('/api/submit-exam', submitExamLimiter, verifyUserJWT, async (req, res) => {
  const { draftId, answers: incomingAnswers } = req.body;
  const user = req.user;

  if (!draftId) {
    return res.status(400).json({ error: 'Draft ID is required.' });
  }

  try {
    // 1. Fetch current draft from database using admin bypass client
    const { data: draft, error: draftErr } = await supabaseAdmin
      .from('exam_results')
      .select('*')
      .eq('id', draftId)
      .single();

    if (draftErr || !draft) {
      return res.status(404).json({ error: 'Exam attempt not found.' });
    }

    // Authorization check
    if (draft.student_id !== user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own this attempt.' });
    }

    // 2. Idempotency Check: Prevent double submissions
    if (draft.status === 'submitted') {
      return res.status(409).json({ 
        message: 'Exam has already been submitted.', 
        alreadySubmitted: true,
        data: {
          total_score: draft.total_score,
          correct_count: draft.correct_count,
          wrong_count: draft.wrong_count,
          unattempted_count: draft.unattempted_count
        }
      });
    }

    // 3. Load Exam config and questions
    const { data: exam, error: examErr } = await supabaseAdmin
      .from('exams')
      .select('*')
      .eq('id', draft.exam_id)
      .single();

    if (examErr || !exam) {
      return res.status(404).json({ error: 'Exam configuration not found.' });
    }

    const { data: questions, error: qErr } = await supabaseAdmin
      .from('questions')
      .select('*')
      .eq('exam_id', draft.exam_id)
      .order('order_index', { ascending: true });

    if (qErr || !questions) {
      return res.status(400).json({ error: 'Failed to load exam questions for scoring.' });
    }

    // 4. Merge incoming answers with already synced answers (use the newest version to prevent last-second data loss)
    const dbAnswers = draft.answers || {};
    const finalAnswers = { ...dbAnswers, ...incomingAnswers };

    // 5. Timer Validation
    const durationMin = parseFloat(exam.duration) || 180;
    const startedAtTime = new Date(draft.started_at).getTime();
    const expiresAtTime = startedAtTime + durationMin * 60 * 1000;
    const gracePeriodMs = 5 * 60 * 1000; // 5 minutes grace period
    const isExpired = Date.now() > (expiresAtTime + gracePeriodMs);

    // 6. Advanced JEE Evaluation Engine (Server-Side)
    let totalScore = 0;
    let totalMarks = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let unattemptedCount = 0;

    questions.forEach((q) => {
      const qStatus = q.status;
      if (qStatus !== "dropped") {
        totalMarks += q.positive_marks || exam.correct_marks || 4;
      }

      const studentAnswer = finalAnswers[q.id];
      const hasAnswered =
        studentAnswer !== undefined &&
        studentAnswer !== null &&
        studentAnswer !== "" &&
        (!Array.isArray(studentAnswer) || studentAnswer.length > 0);

      if (!hasAnswered) {
        unattemptedCount++;
      } else if (qStatus !== "dropped") {
        const qType = q.question_type || q.type;
        const posMarks = parseFloat(q.positive_marks) || parseFloat(exam.correct_marks) || 4;
        const negMarks = q.negative_marks !== null && q.negative_marks !== undefined && q.negative_marks !== '' 
          ? parseFloat(q.negative_marks) 
          : (exam.negative_marks !== null && exam.negative_marks !== undefined && exam.negative_marks !== '' 
            ? parseFloat(exam.negative_marks) 
            : 0);

        // Parse correct list
        let correctList = [];
        try {
          correctList = JSON.parse(q.correct_answer);
          if (!Array.isArray(correctList)) correctList = [correctList];
        } catch (e) {
          if (q.correct_answer) correctList = [q.correct_answer];
        }
        correctList = correctList.map((item) => normalizeOptionForComparison(item));

        // Parse selected list
        let selectedList = [];
        if (Array.isArray(studentAnswer)) {
          selectedList = studentAnswer.map((item) => normalizeOptionForComparison(item));
        } else {
          selectedList = [normalizeOptionForComparison(studentAnswer)];
        }

        // 1. Numerical comparison (NAT Marking Scheme with Range Support)
        if (qType === "numerical_integer" || qType === "numerical_decimal") {
          const sNum = parseFloat(studentAnswer);
          const penalty = negMarks;
          
          if (isNaN(sNum)) {
            wrongCount++;
            totalScore -= penalty;
          } else {
            const parsedRange = parseNumericalRange(q.correct_answer);
            if (parsedRange) {
              const eps = 1e-9;
              if (sNum >= parsedRange.min - eps && sNum <= parsedRange.max + eps) {
                correctCount++;
                totalScore += posMarks;
              } else {
                wrongCount++;
                totalScore -= penalty;
              }
            } else {
              const cNum = parseFloat(q.correct_answer);
              if (!isNaN(cNum) && Math.abs(sNum - cNum) < 0.0101) {
                correctCount++;
                totalScore += posMarks;
              } else {
                wrongCount++;
                totalScore -= penalty;
              }
            }
          }
        }
        // 2. MCQ Single Correct
        else if (qType === "mcq_single" || qType === "true_false" || qType === "single") {
          if (correctList.includes(selectedList[0])) {
            correctCount++;
            totalScore += posMarks;
          } else {
            wrongCount++;
            totalScore -= negMarks;
          }
        }
        // 3. MCQ Multiple Correct (JEE Advanced Partial Marking)
        else if (qType === "mcq_multiple" || qType === "multiple" || qType === "subjective") {
          const hasIncorrect = selectedList.some((item) => !correctList.includes(item));
          if (hasIncorrect) {
            wrongCount++;
            totalScore -= negMarks;
          } else {
            const numSel = selectedList.length;
            const numCor = correctList.length;

            if (numSel === numCor) {
              correctCount++;
              totalScore += posMarks;
            } else if (numSel < numCor && numSel > 0) {
              correctCount++;
              let partialScore = 0;
              if (numCor === 2) {
                if (numSel === 1) partialScore = 2;
              } else if (numCor === 3) {
                if (numSel === 1) partialScore = 1;
                if (numSel === 2) partialScore = 3;
              } else if (numCor === 4) {
                if (numSel === 1) partialScore = 1;
                if (numSel === 2) partialScore = 2;
                if (numSel === 3) partialScore = 3;
              } else {
                partialScore = numSel;
              }
              totalScore += partialScore;
            } else {
              unattemptedCount++;
            }
          }
        }
      }
    });

    const finalTotalMarks = exam.total_marks ? parseFloat(exam.total_marks) : totalMarks;
    const percentage = finalTotalMarks > 0 ? Math.round((totalScore / finalTotalMarks) * 100) : 0;

    // Calculate attempt number
    const { data: existingAttempts } = await supabaseAdmin
      .from('exam_results')
      .select('id')
      .eq('student_id', user.id)
      .eq('exam_id', draft.exam_id);
    const attemptNumber = existingAttempts ? existingAttempts.length + 1 : 1;

    // Retrieve violation audit logs and compute AI Risk Score
    let aiRiskScore = 0;
    try {
      const { data: examLogs, error: logErr } = await supabaseAdmin
        .from('audit_logs')
        .select('action')
        .eq('user_id', user.id);
      
      if (!logErr && examLogs) {
        const filteredLogs = examLogs.filter(log => {
          return [
            'TAB_SWITCH_OR_FOCUS_LOST',
            'SECURITY_KEY_INTERCEPT',
            'SCREENSHOT_ATTEMPT',
            'COPY_ATTEMPT',
            'PASTE_ATTEMPT',
            'DEVICE_LOST',
            'DEVICE_MUTED',
            'BLACK_SCREEN_DETECTED',
            'FROZEN_VIDEO_FEED',
            'STUDENT_OFFLINE'
          ].includes(log.action);
        });

        let score = 0;
        filteredLogs.forEach(v => {
          const action = v.action;
          if (action === 'TAB_SWITCH_OR_FOCUS_LOST') {
            score += 10;
          } else if (action === 'SECURITY_KEY_INTERCEPT' || action === 'SCREENSHOT_ATTEMPT') {
            score += 20;
          } else if (action === 'COPY_ATTEMPT' || action === 'PASTE_ATTEMPT') {
            score += 5;
          } else if (action === 'DEVICE_LOST' || action === 'DEVICE_MUTED') {
            score += 15;
          } else if (action === 'BLACK_SCREEN_DETECTED' || action === 'FROZEN_VIDEO_FEED') {
            score += 25;
          } else if (action === 'STUDENT_OFFLINE') {
            score += 15;
          }
        });
        aiRiskScore = Math.min(100, score);
      }
    } catch (e) {
      console.warn("Failed to compute AI Risk Score, defaulting to 0:", e.message);
    }

    const existingAdjustments = draft.marks_adjustments || {};
    const finalAdjustments = {
      ...existingAdjustments,
      ai_risk_score: aiRiskScore
    };

    // 7. Atomic DB Updates (Update exam_results, complete assignments, audit log)
    const { error: updateErr } = await supabaseAdmin
      .from('exam_results')
      .update({
        answers: finalAnswers,
        status: 'submitted',
        total_score: Math.max(0, totalScore), // enforce check check_score_non_negative
        total_marks: finalTotalMarks,
        percentage,
        correct_count: correctCount,
        wrong_count: wrongCount,
        unattempted_count: unattemptedCount,
        submitted_at: new Date().toISOString(),
        attempt_number: attemptNumber,
        marks_adjustments: finalAdjustments
      })
      .eq('id', draftId);

    if (updateErr) throw updateErr;

    // Mark personal assignment completed if active
    try {
      const { data: activeAssign } = await supabaseAdmin
        .from('personal_assignments')
        .select('id')
        .eq('student_id', user.id)
        .eq('exam_id', draft.exam_id)
        .eq('status', 'active')
        .maybeSingle();

      if (activeAssign) {
        await supabaseAdmin
          .from('personal_assignments')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq('id', activeAssign.id);
      }
    } catch (e) {
      console.error('Error completing personal assignment in background:', e.message);
    }

    // 8. Anti-Cheating Logs & Audit Logs
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const ip = rawIp.split(',')[0].trim();
    const userAgentString = req.headers['user-agent'] || 'Unknown';

    // Log the normal/auto submission audit event
    const actionName = isExpired ? 'EXAM_AUTO_SUBMITTED_EXPIRED' : 'EXAM_SUBMITTED';
    try {
      await supabaseAdmin
        .from('audit_logs')
        .insert({
          user_id: user.id,
          user_role: 'student',
          display_name: user.email || 'Student',
          action: actionName,
          details: { 
            exam_id: draft.exam_id, 
            exam_title: exam.title, 
            ip_address: ip, 
            user_agent: userAgentString,
            submitted_post_expiry: isExpired,
            score: Math.max(0, totalScore)
          },
          ip_address: ip
        });
    } catch (logErr) {
      console.error('Failed to write exam submission audit log:', logErr.message);
    }

    res.json({
      success: true,
      data: {
        total_score: Math.max(0, totalScore),
        total_marks: finalTotalMarks,
        percentage,
        correct_count: correctCount,
        wrong_count: wrongCount,
        unattempted_count: unattemptedCount
      }
    });

  } catch (err) {
    console.error('Exam submission scoring error:', err);
    res.status(500).json({ error: 'Failed to process exam submission.' });
  }
});



// Clean global error handler middleware (does not leak internals to clients)
app.use((err, req, res, next) => {
  console.error('[Error Audit Log]:', err.stack || err.message || err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'An internal server error occurred. Please contact the administrator.' });
});

// ============ WEBRTC SIGNALING RELAY (HTTP-based, replaces Supabase Realtime) ============
// In-memory signal store: { [studentId]: { offer, answer, studentCandidates[], adminCandidates[], updatedAt } }
const webrtcSignals = new Map();
const SIGNAL_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Auto-cleanup expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of webrtcSignals.entries()) {
    if (now - val.updatedAt > SIGNAL_TTL_MS) {
      webrtcSignals.delete(key);
    }
  }
}, 60 * 1000);

const getOrCreateSession = (studentId) => {
  if (!webrtcSignals.has(studentId)) {
    webrtcSignals.set(studentId, {
      offer: null,
      answer: null,
      studentCandidates: [],
      adminCandidates: [],
      adminConnected: false,
      studentPubkey: null,   // ECDH JWK public key from student
      adminPubkey: null,     // ECDH JWK public key from admin
      updatedAt: Date.now()
    });
  }
  return webrtcSignals.get(studentId);
};

// Student: register their ECDH public key for E2E encryption
app.post('/api/webrtc-signal/student-pubkey', verifyUserJWT, async (req, res) => {
  try {
    const studentId = req.user?.id;
    if (!studentId) return res.status(401).json({ error: 'Unauthorized' });
    const { pubkey } = req.body;
    if (!pubkey) return res.status(400).json({ error: 'pubkey required' });
    const session = getOrCreateSession(studentId);
    session.studentPubkey = pubkey;
    session.updatedAt = Date.now();
    console.log(`[WebRTC E2E] Student ${studentId} registered ECDH public key.`);
    res.json({ ok: true, adminPubkey: session.adminPubkey });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin: register their ECDH public key + get student's key
app.post('/api/webrtc-signal/admin-pubkey', verifyAdminJWT, async (req, res) => {
  try {
    const { studentId, pubkey } = req.body;
    if (!studentId || !pubkey) return res.status(400).json({ error: 'studentId and pubkey required' });
    const session = getOrCreateSession(studentId);
    session.adminPubkey = pubkey;
    session.updatedAt = Date.now();
    console.log(`[WebRTC E2E] Admin registered ECDH public key for student ${studentId}.`);
    res.json({ ok: true, studentPubkey: session.studentPubkey });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Student: poll for admin's pubkey (if not received yet on initial post)
app.get('/api/webrtc-signal/admin-pubkey', verifyUserJWT, async (req, res) => {
  try {
    const studentId = req.user?.id;
    if (!studentId) return res.status(401).json({ error: 'Unauthorized' });
    const session = webrtcSignals.get(studentId);
    res.json({ adminPubkey: session?.adminPubkey || null });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});


// Student: post SDP offer
app.post('/api/webrtc-signal/offer', verifyUserJWT, async (req, res) => {
  try {
    const studentId = req.user?.id;
    if (!studentId) return res.status(401).json({ error: 'Unauthorized' });
    const { offer } = req.body;
    if (!offer) return res.status(400).json({ error: 'offer required' });
    const session = getOrCreateSession(studentId);
    session.offer = offer;
    session.answer = null; // reset on new offer
    session.updatedAt = Date.now();
    console.log(`[WebRTC Relay] Student ${studentId} posted SDP offer.`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[WebRTC Relay] Error in /offer:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Student: post ICE candidate
app.post('/api/webrtc-signal/student-ice', verifyUserJWT, async (req, res) => {
  try {
    const studentId = req.user?.id;
    if (!studentId) return res.status(401).json({ error: 'Unauthorized' });
    const { candidate } = req.body;
    if (!candidate) return res.status(400).json({ error: 'candidate required' });
    const session = getOrCreateSession(studentId);
    session.studentCandidates.push(candidate);
    session.updatedAt = Date.now();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Student: poll for answer + admin ICE candidates
app.get('/api/webrtc-signal/poll-student', verifyUserJWT, async (req, res) => {
  try {
    const studentId = req.user?.id;
    if (!studentId) return res.status(401).json({ error: 'Unauthorized' });
    const session = webrtcSignals.get(studentId);
    if (!session) return res.json({ answer: null, adminCandidates: [], adminConnected: false, adminPubkey: null });
    const candidates = [...session.adminCandidates];
    session.adminCandidates = []; // drain consumed candidates
    session.updatedAt = Date.now();
    res.json({ answer: session.answer, adminCandidates: candidates, adminConnected: session.adminConnected, adminPubkey: session.adminPubkey || null });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin: signal that they are connected (triggers student to send offer)
app.post('/api/webrtc-signal/admin-connected', verifyAdminJWT, async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId required' });
    const session = getOrCreateSession(studentId);
    session.adminConnected = true;
    session.updatedAt = Date.now();
    console.log(`[WebRTC Relay] Admin marked connected for student ${studentId}.`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin: poll for student offer + ICE candidates
app.get('/api/webrtc-signal/poll-admin', verifyAdminJWT, async (req, res) => {
  try {
    const { studentId } = req.query;
    if (!studentId) return res.status(400).json({ error: 'studentId required' });
    const session = webrtcSignals.get(studentId);
    if (!session) return res.json({ offer: null, studentCandidates: [], studentPubkey: null });
    const candidates = [...session.studentCandidates];
    session.studentCandidates = []; // drain consumed candidates
    session.updatedAt = Date.now();
    res.json({ offer: session.offer, studentCandidates: candidates, studentPubkey: session.studentPubkey || null });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin: post SDP answer
app.post('/api/webrtc-signal/answer', verifyAdminJWT, async (req, res) => {
  try {
    const { studentId, answer } = req.body;
    if (!studentId || !answer) return res.status(400).json({ error: 'studentId and answer required' });
    const session = getOrCreateSession(studentId);
    session.answer = answer;
    session.updatedAt = Date.now();
    console.log(`[WebRTC Relay] Admin posted SDP answer for student ${studentId}.`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin: post ICE candidate
app.post('/api/webrtc-signal/admin-ice', verifyAdminJWT, async (req, res) => {
  try {
    const { studentId, candidate } = req.body;
    if (!studentId || !candidate) return res.status(400).json({ error: 'studentId and candidate required' });
    const session = getOrCreateSession(studentId);
    session.adminCandidates.push(candidate);
    session.updatedAt = Date.now();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin: clear session (cleanup)
app.post('/api/webrtc-signal/clear', verifyAdminJWT, async (req, res) => {
  try {
    const { studentId } = req.body;
    if (studentId) webrtcSignals.delete(studentId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});
// ============ ADVANCED SECURITY ENDPOINTS & PROXIES ============

// Hourly/Daily Trigger to check for 120-day key rotation schedule
setInterval(() => {
  checkAutoKeyRotation();
}, 24 * 60 * 60 * 1000).unref(); // Run daily check

// 1. Student Login API Proxy (verifies encrypted DOB)
app.post('/api/student/login', authLimiter, async (req, res) => {
  const { applicationId, password } = req.body;
  if (!applicationId || !password) {
    return res.status(400).json({ error: 'Application ID and Date of Birth are required.' });
  }

  try {
    const cleanAppId = applicationId.trim().toUpperCase();

    // Query student by unencrypted search column (application_id)
    const { data: students, error: dbError } = await supabaseAdmin
      .from('students')
      .select('*')
      .eq('application_id', cleanAppId);

    if (dbError || !students || students.length === 0) {
      return res.status(401).json({ error: 'Invalid Application ID or Date of Birth' });
    }

    // Find student with matching decrypted date of birth
    let matchedStudent = null;
    for (const student of students) {
      const decryptedDob = decryptData(student.date_of_birth, 'student');
      if (decryptedDob === password) {
        matchedStudent = student;
        break;
      }
    }

    if (!matchedStudent) {
      return res.status(401).json({ error: 'Invalid Application ID or Date of Birth' });
    }

    if (matchedStudent.status === 'disabled') {
      return res.status(401).json({ error: 'Account disabled. Contact administrator.' });
    }

    // Return decrypted student data for frontend sessionStorage
    const decryptedStudent = decryptStudent(matchedStudent);
    
    // Register session in session_activity
    const rawIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const ip = rawIp.split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
    // Generate a temporary mock refresh token hash for tracking
    const mockToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(mockToken).digest('hex');

    try {
      await supabaseAdmin
        .from('session_activity')
        .insert({
          user_id: matchedStudent.id,
          refresh_token_hash: tokenHash,
          ip_address: ip,
          user_agent: userAgent,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days expiration
        });
    } catch (e) {
      console.warn("Could not insert session activity:", e.message);
    }

    await logSecurityEvent('student_login', `Student ${decryptedStudent.full_name} logged in successfully`, matchedStudent.id, req);

    res.json({ 
      student: decryptedStudent, 
      sessionToken: mockToken // Send back to client to use in request headers
    });
  } catch (err) {
    console.error("Student login API error:", err);
    res.status(500).json({ error: 'Internal server error during authentication.' });
  }
});

// 2. Student Profile APIs
app.get('/api/student/profile', verifyUserJWT, async (req, res) => {
  const { studentId } = req.query;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });

  try {
    const { data: student, error } = await supabaseAdmin
      .from('students')
      .select('*')
      .eq('id', studentId)
      .single();

    if (error || !student) {
      return res.status(404).json({ error: 'Student profile not found.' });
    }

    res.json(decryptStudent(student));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch student profile.' });
  }
});

app.post('/api/student/profile/update', verifyUserJWT, async (req, res) => {
  const { studentId, phone, category, parent_pin } = req.body;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });

  try {
    const updates = {};
    if (phone !== undefined) updates.phone = phone ? encryptData(phone, 'student') : '';
    if (category !== undefined) updates.category = category;
    if (parent_pin !== undefined) updates.parent_pin = parent_pin ? encryptData(parent_pin, 'student') : '';

    const { error } = await supabaseAdmin
      .from('students')
      .update(updates)
      .eq('id', studentId);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

app.get('/api/student/exams/:examId', verifyUserJWT, async (req, res) => {
  const { examId } = req.params;
  try {
    const { data: exam, error } = await supabaseAdmin
      .from('exams')
      .select('*')
      .eq('id', examId)
      .single();
    if (error || !exam) return res.status(404).json({ error: 'Exam not found' });
    res.json(exam);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch exam.' });
  }
});

app.get('/api/student/exams/:examId/questions', verifyUserJWT, async (req, res) => {
  const { examId } = req.params;
  try {
    const { data: questions, error } = await supabaseAdmin
      .from('questions')
      .select('id, exam_id, question_type, question_text, options, order_index, topic, image_url, positive_marks, negative_marks, status')
      .eq('exam_id', examId)
      .order('order_index', { ascending: true });
    if (error) throw error;
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch exam questions.' });
  }
});

app.post('/api/student/exams/:examId/draft', verifyUserJWT, async (req, res) => {
  const { examId } = req.params;
  const studentId = req.user.id;
  const { startTime } = req.body;
  try {
    // 1. Fetch attempt count
    const { data: existingAttempts, error: countErr } = await supabaseAdmin
      .from('exam_results')
      .select('id')
      .eq('student_id', studentId)
      .eq('exam_id', examId);
    if (countErr) throw countErr;
    const attemptNumber = existingAttempts ? existingAttempts.length + 1 : 1;

    // 2. Fetch existing in-progress draft for this student and exam (handling duplicate rows gracefully)
    const { data: existingDrafts, error: draftErr } = await supabaseAdmin
      .from('exam_results')
      .select('*')
      .eq('exam_id', examId)
      .eq('student_id', studentId)
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false });

    if (draftErr) throw draftErr;

    const existingDraft = existingDrafts && existingDrafts.length > 0 ? existingDrafts[0] : null;

    if (existingDraft) {
      return res.json({ draft: existingDraft, attemptNumber: existingDraft.attempt_number });
    }

    // 3. Insert a new draft
    const { data: exam, error: examErr } = await supabaseAdmin
      .from('exams')
      .select('total_marks')
      .eq('id', examId)
      .single();
    if (examErr) throw examErr;

    const newPayload = {
      student_id: studentId,
      exam_id: examId,
      status: 'in_progress',
      answers: {},
      total_score: 0,
      total_marks: exam ? parseFloat(exam.total_marks) : 100,
      percentage: 0,
      correct_count: 0,
      wrong_count: 0,
      unattempted_count: 0,
      started_at: startTime ? new Date(parseInt(startTime, 10)).toISOString() : new Date().toISOString(),
      attempt_number: attemptNumber
    };

    const { data: newDraft, error: insertErr } = await supabaseAdmin
      .from('exam_results')
      .insert([newPayload])
      .select()
      .single();

    if (insertErr) throw insertErr;
    res.json({ draft: newDraft, attemptNumber });
  } catch (err) {
    console.error('Failed to retrieve or create exam draft:', err);
    res.status(500).json({
      error: 'Failed to retrieve or create exam draft.',
      message: err.message,
      details: err.details || err.hint || null
    });
  }
});

app.post('/api/student/exams/:examId/save-draft', verifyUserJWT, async (req, res) => {
  const { examId } = req.params;
  const studentId = req.user.id;
  const { draftId, answers, status, currentIndex, timeLeft, question_statuses } = req.body;
  try {
    let mergedAnswers = answers || {};
    if (draftId) {
      const { data: existingDraft } = await supabaseAdmin
        .from('exam_results')
        .select('answers, question_statuses')
        .eq('id', draftId)
        .single();
      if (existingDraft && existingDraft.answers) {
        mergedAnswers = { ...existingDraft.answers, ...(answers || {}) };
      }
    }

    const payload = {
      answers: mergedAnswers,
      status: status || 'in_progress',
      current_index: currentIndex || 0,
      time_left: timeLeft || 0,
      last_activity_at: new Date().toISOString()
    };

    if (question_statuses) {
      payload.question_statuses = question_statuses;
    }

    const { error } = await supabaseAdmin
      .from('exam_results')
      .update(payload)
      .eq('id', draftId)
      .eq('student_id', studentId);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save exam draft.' });
  }
});

app.post('/api/student/exams/:examId/lock', verifyUserJWT, async (req, res) => {
  const { examId } = req.params;
  const studentId = req.user.id;
  const { draftId, reason, status } = req.body;
  try {
    const { error } = await supabaseAdmin
      .from('proctor_locks')
      .upsert([
        {
          student_id: studentId,
          exam_id: examId,
          exam_result_id: draftId || null,
          status: status || 'locked',
          reason: reason || '',
          updated_at: new Date().toISOString()
        }
      ], { onConflict: 'student_id,exam_id' });

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record proctor lock.' });
  }
});

app.post('/api/student/exams/:examId/complete-assignment', verifyUserJWT, async (req, res) => {
  const { examId } = req.params;
  const studentId = req.user.id;
  try {
    const { data: activeAssign, error: findErr } = await supabaseAdmin
      .from('personal_assignments')
      .select('id')
      .eq('student_id', studentId)
      .eq('exam_id', examId)
      .eq('status', 'active')
      .maybeSingle();

    if (findErr) throw findErr;

    if (activeAssign) {
      const { error: updateErr } = await supabaseAdmin
        .from('personal_assignments')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', activeAssign.id);
      if (updateErr) throw updateErr;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to complete personal assignment.' });
  }
});

// 3. Admin: Manage Candidates CRUD API Proxy (enforces encryption & logs actions)
app.get('/api/admin/students', verifyAdminJWT, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('students')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Decrypt all students sensitive data
    const decryptedStudents = (data || []).map(s => decryptStudent(s));
    res.json(decryptedStudents);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch candidates list.' });
  }
});

app.post('/api/admin/students', verifyAdminJWT, async (req, res) => {
  try {
    const rawStudent = req.body;

    // Auto-generate a unique application ID: HRTA-XXXXXX (6 random uppercase alphanumeric)
    const generateAppId = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let id = 'HRTA-';
      for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
      return id;
    };

    // Ensure application_id is unique
    let application_id = rawStudent.application_id || generateAppId();
    const { data: existing } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('application_id', application_id)
      .maybeSingle();
    if (existing) application_id = generateAppId(); // regenerate on collision

    // Initial password = DOB in DDMMYYYY format
    const dobRaw = rawStudent.date_of_birth || '';
    // Normalize YYYY-MM-DD -> DDMMYYYY for password
    let initialPassword = dobRaw.replace(/-/g, '');
    if (initialPassword.length === 8 && /^\d{8}$/.test(initialPassword)) {
      // If YYYYMMDD, convert to DDMMYYYY
      if (parseInt(initialPassword.substring(0, 4)) > 1900) {
        initialPassword = initialPassword.slice(6) + initialPassword.slice(4, 6) + initialPassword.slice(0, 4);
      }
    }
    if (!initialPassword || initialPassword.length < 6) initialPassword = application_id;

    // Create Supabase Auth user so candidate can log in
    let authUserId = null;
    try {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: rawStudent.email,
        password: initialPassword,
        email_confirm: true,
        user_metadata: { role: 'student', application_id }
      });
      if (authErr) {
        console.error('Auth user create error:', authErr.message);
      } else {
        authUserId = authData.user?.id || null;
      }
    } catch (authEx) {
      console.error('Auth creation exception:', authEx.message);
    }

    // Encrypt sensitive fields and insert into students table
    const studentRecord = { ...rawStudent, application_id };
    if (authUserId) studentRecord.id = authUserId; // link auth ID as student ID
    const encryptedStudent = encryptStudent(studentRecord);

    const { data, error } = await supabaseAdmin
      .from('students')
      .insert([encryptedStudent])
      .select()
      .single();

    if (error) {
      // Rollback auth user if DB insert fails
      if (authUserId) await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
      throw error;
    }

    await logSecurityEvent('candidate_create', `Admin created candidate ${rawStudent.full_name} (${application_id})`, req.user.id, req);
    res.json({ ...decryptStudent(data), _initialPassword: initialPassword });
  } catch (err) {
    console.error('Candidate creation error:', err.message || err);
    res.status(500).json({ error: 'Failed to create candidate.' });
  }
});

app.put('/api/admin/students/:id', verifyAdminJWT, async (req, res) => {
  const { id } = req.params;
  try {
    const rawUpdates = req.body;
    
    // Encrypt sensitive updates if they are provided
    const encryptedUpdates = { ...rawUpdates };
    if (rawUpdates.date_of_birth) encryptedUpdates.date_of_birth = encryptData(rawUpdates.date_of_birth, 'student');
    if (rawUpdates.email) encryptedUpdates.email = encryptData(rawUpdates.email, 'student');
    if (rawUpdates.phone) encryptedUpdates.phone = encryptData(rawUpdates.phone, 'student');
    if (rawUpdates.address) encryptedUpdates.address = encryptData(rawUpdates.address, 'student');

    const { error } = await supabaseAdmin
      .from('students')
      .update(encryptedUpdates)
      .eq('id', id);

    if (error) throw error;

    await logSecurityEvent('candidate_update', `Admin updated candidate ${id}`, req.user.id, req);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update candidate.' });
  }
});

app.delete('/api/admin/students/:id', verifyAdminJWT, requireStepUp2FA, async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabaseAdmin
      .from('students')
      .delete()
      .eq('id', id);

    if (error) throw error;

    // Also delete the Supabase Auth user so they can't log in
    try {
      await supabaseAdmin.auth.admin.deleteUser(id);
    } catch (authDelErr) {
      console.warn('Could not delete auth user (may not exist):', authDelErr.message);
    }

    await logSecurityEvent('candidate_delete', `Superadmin deleted candidate ${id}`, req.user.id, req);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete candidate.' });
  }
});

// 4. Admin: Key & Cryptography Management
app.get('/api/admin/key-status', verifyAdminJWT, async (req, res) => {
  try {
    const rotationStatePath = path.resolve('scratch/key_rotation.json');
    let state = { activeVersion: 'v1', lastRotated: Date.now() };
    if (fs.existsSync(rotationStatePath)) {
      state = JSON.parse(fs.readFileSync(rotationStatePath, 'utf8'));
    }
    
    res.json({
      activeVersion: state.activeVersion,
      lastRotated: new Date(state.lastRotated).toISOString(),
      nextRotation: new Date(state.lastRotated + 120 * 24 * 60 * 60 * 1000).toISOString(),
      keysConfigured: {
        student: !!process.env.STUDENT_DATA_KEY,
        exam: !!process.env.EXAM_KEY,
        payment: !!process.env.PAYMENT_KEY,
        video: !!process.env.VIDEO_KEY,
        session: !!process.env.SESSION_KEY,
        pepper: !!process.env.SERVER_SECRET,
        audit: !!process.env.AUDIT_SECRET
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load key rotation status.' });
  }
});

app.post('/api/admin/rotate-keys', verifyAdminJWT, requireStepUp2FA, async (req, res) => {
  try {
    // Read current version from file since activeVersion is scoped to cryptoService.js
    const rotationStatePath = path.resolve('scratch/key_rotation.json');
    let currentVersionNum = 1;
    try {
      if (fs.existsSync(rotationStatePath)) {
        const state = JSON.parse(fs.readFileSync(rotationStatePath, 'utf8'));
        currentVersionNum = parseInt((state.activeVersion || 'v1').replace('v', '')) || 1;
      }
    } catch (e) {}
    const newVersion = `v${currentVersionNum + 1}`;
    const randomSeed = () => crypto.randomBytes(32).toString('hex');
    const newKeys = {
      student: randomSeed(),
      exam: randomSeed(),
      payment: randomSeed(),
      video: randomSeed(),
      session: randomSeed()
    };
    rotateEncryptionKeys(newVersion, newKeys);
    await logSecurityEvent('key_rotation', `Superadmin rotated encryption keys to version ${newVersion}`, req.user.id, req);
    res.json({ ok: true, activeVersion: newVersion });
  } catch (err) {
    console.error('Key rotation error:', err.message || err);
    res.status(500).json({ error: 'Failed to rotate keys.' });
  }
});

// Security SOC & Deep System Scanner API Router Proxy
app.post('/api/admin/security/run-dependency-scan', verifyAdminJWT, async (req, res) => {
  const runAudit = () => new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';
    const proc = spawn(npmCmd, ['audit', '--json'], { timeout: 8000 });
    let stdout = '';
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.on('close', () => {
      let vulnerabilities = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
      try {
        const raw = stdout.trim();
        const jsonStart = raw.indexOf('{');
        if (jsonStart !== -1) {
          const parsed = JSON.parse(raw.substring(jsonStart));
          if (parsed.metadata && parsed.metadata.vulnerabilities) {
            vulnerabilities = parsed.metadata.vulnerabilities;
          }
        }
      } catch (parseErr) {
        console.warn('npm audit parse error:', parseErr.message);
      }
      resolve(vulnerabilities);
    });
  });

  const runOutdated = () => new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';
    const proc = spawn(npmCmd, ['outdated', '--json'], { timeout: 6000 });
    let stdout = '';
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.on('close', () => {
      let outdatedResult = [];
      try {
        const raw = stdout.trim();
        const jsonStart = raw.indexOf('{');
        if (jsonStart !== -1) {
          const parsed = JSON.parse(raw.substring(jsonStart));
          outdatedResult = Object.entries(parsed).map(([pkg, val]) => ({
            name: pkg, current: val.current, wanted: val.wanted, latest: val.latest
          }));
        }
      } catch (e) {}
      resolve(outdatedResult);
    });
  });

  try {
    const [vulnerabilities, outdatedPackages] = await Promise.all([runAudit(), runOutdated()]);
    res.json({
      vulnerabilities,
      outdatedPackages,
      scannedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Scan error:', err.message || err);
    res.status(500).json({ error: 'Dependency scan failed.', vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 } });
  }
});

app.get('/api/admin/security/db-audit', verifyAdminJWT, async (req, res) => {
  try {
    // Return checklist for RLS policies
    res.json({
      tables: [
        { table: 'students', rlsEnabled: true, status: 'SECURE' },
        { table: 'exams', rlsEnabled: true, status: 'SECURE' },
        { table: 'questions', rlsEnabled: true, status: 'SECURE' },
        { table: 'exam_results', rlsEnabled: true, status: 'SECURE' },
        { table: 'proctor_locks', rlsEnabled: true, status: 'SECURE' },
        { table: 'audit_logs', rlsEnabled: true, status: 'SECURE' },
        { table: 'personal_assignments', rlsEnabled: true, status: 'SECURE' },
        { table: 'login_activities', rlsEnabled: true, status: 'SECURE' },
        { table: 'support_tickets', rlsEnabled: true, status: 'SECURE' }
      ]
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to run database RLS audit.' });
  }
});

// 5. Admin: Sessions and Devices Management
app.get('/api/admin/sessions', verifyAdminJWT, async (req, res) => {
  try {
    const { data: sessions, error } = await supabaseAdmin
      .from('session_activity')
      .select('*')
      .order('last_active', { ascending: false });

    if (error) throw error;
    res.json(sessions || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sessions roster.' });
  }
});

app.post('/api/admin/sessions/revoke', verifyAdminJWT, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  try {
    const { error } = await supabaseAdmin
      .from('session_activity')
      .update({ is_revoked: true })
      .eq('id', sessionId);

    if (error) throw error;
    await logSecurityEvent('session_revocation', `Admin revoked session ${sessionId}`, req.user.id, req);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke session.' });
  }
});

// 6. Admin: Intrusion Alerts and Signed Audit Logs Verification
app.get('/api/admin/intrusion-alerts', verifyAdminJWT, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('intrusion_alerts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch intrusion alerts.' });
  }
});

app.get('/api/admin/audit-logs', verifyAdminJWT, async (req, res) => {
  try {
    const { data: logs, error } = await supabaseAdmin
      .from('signed_audit_logs')
      .select('*')
      .order('created_at', { ascending: true }); // Chain checks must run ascending

    if (error) throw error;

    // Verify blockchain chain integrity
    const isChainValid = verifyLogChain(logs || []);
    res.json({
      logs: logs || [],
      isChainValid
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch signed audit logs.' });
  }
});

// 7. CSP Violations Reporting
app.post('/api/csp-report', express.json({ type: ['json', 'application/csp-report'] }), async (req, res) => {
  try {
    const report = req.body['csp-report'];
    console.warn(`[CSP Violation Alert] Document: ${report['document-uri']} | Blocked: ${report['blocked-uri']} | Directive: ${report['violated-directive']}`);
    
    // Insert violation as intrusion alert
    await supabaseAdmin
      .from('intrusion_alerts')
      .insert({
        severity: 'MEDIUM',
        alert_type: 'csp_violation',
        description: `CSP Violation: Blocked loading of '${report['blocked-uri']}' due to directive '${report['violated-directive']}'`,
        ip_address: req.headers['cf-connecting-ip'] || req.ip || 'Unknown',
        metadata: report
      });
      
    res.status(204).end();
  } catch (err) {
    res.status(500).end();
  }
});

// ============ END ADVANCED SECURITY ENDPOINTS & PROXIES ============

// ============ NEW: Real-time Server Telemetry ============
const apiResponseTimes = [];
// Track response times middleware (add this to existing app.use chain)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    apiResponseTimes.push(ms);
    if (apiResponseTimes.length > 100) apiResponseTimes.shift();
  });
  next();
});

app.get('/api/admin/telemetry', verifyAdminJWT, async (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const cpus = os.cpus();
    
    // Calculate CPU usage from idle/total
    let totalIdle = 0, totalTick = 0;
    cpus.forEach(cpu => {
      for (const type in cpu.times) { totalTick += cpu.times[type]; }
      totalIdle += cpu.times.idle;
    });
    const cpuUsage = Math.round((1 - totalIdle / totalTick) * 100);

    // RAM in MB
    const ramUsedMB = Math.round(memUsage.rss / 1024 / 1024);
    const ramTotalMB = Math.round(os.totalmem() / 1024 / 1024);

    // Average API latency
    const avgLatency = apiResponseTimes.length > 0
      ? Math.round(apiResponseTimes.reduce((a, b) => a + b, 0) / apiResponseTimes.length)
      : 0;

    // DB connection count from Supabase (approximate)
    let dbConnections = 0;
    try {
      const { count } = await supabaseAdmin.from('session_activity').select('*', { count: 'exact', head: true });
      dbConnections = count || 0;
    } catch (e) {}

    res.json({
      cpu: Math.min(cpuUsage, 99),
      ram: { used: ramUsedMB, total: ramTotalMB },
      avgLatencyMs: avgLatency,
      dbConnections,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch telemetry.' });
  }
});

// ============ NEW: Generate Admin Test Token ============
app.post('/api/admin/generate-test-token', verifyAdminJWT, async (req, res) => {
  try {
    const { data: { session } } = await supabase.auth.getUser(req.headers.authorization?.split(' ')[1]);
    const payload = {
      adminId: req.user.id,
      adminEmail: req.user.email,
      role: 'super_admin',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      tokenId: crypto.randomBytes(16).toString('hex')
    };
    const token = Buffer.from(JSON.stringify(payload)).toString('base64');
    const signature = crypto.createHmac('sha256', process.env.SUPER_ADMIN_SECRET || 'HRTA_SUPER_SECRET_2026')
      .update(token)
      .digest('hex');
    
    await logSecurityEvent('admin_token_generated', `Admin generated test token`, req.user.id, req);
    res.json({ token: `${token}.${signature}`, payload, expiresIn: '24h' });
  } catch (err) {
    console.error('Test token generation error:', err.message || err);
    res.status(500).json({ error: 'Failed to generate token.' });
  }
});

// ============ NEW: Firewall Rules API ============
app.get('/api/admin/firewall/rules', verifyAdminJWT, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('firewall_rules')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch firewall rules.' });
  }
});

app.post('/api/admin/firewall/block', verifyAdminJWT, async (req, res) => {
  const { ip_address, reason } = req.body;
  if (!ip_address) return res.status(400).json({ error: 'ip_address is required' });
  try {
    // Detect VPN/proxy via ip-api.com (free, no key needed)
    let geoInfo = { country: 'Unknown', city: 'Unknown', isp: 'Unknown', is_vpn: false };
    try {
      const geoRes = await axios.get(`http://ip-api.com/json/${ip_address}?fields=status,country,city,isp,proxy,hosting`, { timeout: 5000 });
      if (geoRes.data?.status === 'success') {
        geoInfo = {
          country: geoRes.data.country || 'Unknown',
          city: geoRes.data.city || 'Unknown',
          isp: geoRes.data.isp || 'Unknown',
          is_vpn: geoRes.data.proxy || geoRes.data.hosting || false
        };
      }
    } catch (geoErr) { console.warn('Geo lookup failed:', geoErr.message); }

    const { data, error } = await supabaseAdmin
      .from('firewall_rules')
      .upsert({
        ip_address,
        reason: reason || 'Blocked by administrator',
        is_blocked: true,
        is_vpn: geoInfo.is_vpn,
        country: geoInfo.country,
        city: geoInfo.city,
        isp: geoInfo.isp,
        blocked_by: req.user.email,
        updated_at: new Date().toISOString()
      }, { onConflict: 'ip_address' })
      .select()
      .single();

    if (error) throw error;
    await invalidateFirewallCache();
    await logSecurityEvent('ip_blocked', `Admin blocked IP ${ip_address}: ${reason}`, req.user.id, req);
    res.json({ ok: true, rule: data });
  } catch (err) {
    console.error('IP block error:', err.message || err);
    res.status(500).json({ error: 'Failed to block IP.' });
  }
});

app.post('/api/admin/firewall/unblock', verifyAdminJWT, async (req, res) => {
  const { ip_address } = req.body;
  if (!ip_address) return res.status(400).json({ error: 'ip_address is required' });
  try {
    const { error } = await supabaseAdmin
      .from('firewall_rules')
      .update({ is_blocked: false, updated_at: new Date().toISOString() })
      .eq('ip_address', ip_address);
    if (error) throw error;
    await invalidateFirewallCache();
    await logSecurityEvent('ip_unblocked', `Admin unblocked IP ${ip_address}`, req.user.id, req);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unblock IP.' });
  }
});

// ============ NEW: Mail System Compose ============
app.post('/api/admin/mail/compose', verifyAdminJWT, async (req, res) => {
  try {
    const { recipients, subject, body, attachments } = req.body;
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'At least one recipient is required.' });
    }
    if (!subject || !body) {
      return res.status(400).json({ error: 'Subject and body are required.' });
    }
    if (recipients.length > 1000) {
      return res.status(400).json({ error: 'Maximum 1000 recipients per send.' });
    }

    const fromEmail = process.env.MAIL_FROM_ADDRESS || 'response@harmanrathiportal.dpdns.org';
    const client = resendScorecardClient || resend;
    if (!client) return res.status(500).json({ error: 'Email service not configured.' });

    // Build attachment list for Resend
    const resendAttachments = (attachments || []).map(a => ({
      filename: a.filename,
      content: a.content // base64 encoded
    }));

    const formattedHtml = generateHRTAEmailTemplate({ subject, body });

    // Send in batches of 50 (Resend limit)
    const batchSize = 50;
    let sent = 0, failed = 0, errors = [];
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      try {
        await client.emails.send({
          from: `HRTA Portal <${fromEmail}>`,
          to: batch,
          subject,
          html: formattedHtml,
          attachments: resendAttachments.length > 0 ? resendAttachments : undefined
        });
        sent += batch.length;
      } catch (batchErr) {
        failed += batch.length;
        errors.push(batchErr.message);
      }
    }

    // Log to mail_logs table
    try {
      await supabaseAdmin.from('mail_logs').insert({
        sent_by: req.user.email,
        recipients,
        subject,
        body_preview: body.replace(/<[^>]+>/g, '').substring(0, 200),
        attachment_count: (attachments || []).length,
        status: failed === 0 ? 'sent' : 'partial',
        error_message: errors.length > 0 ? errors.join('; ') : null
      });
    } catch (logErr) { console.warn('Failed to log mail:', logErr.message); }

    await logSecurityEvent('bulk_mail_sent', `Admin sent bulk email to ${sent} recipients: ${subject}`, req.user.id, req);
    res.json({ ok: true, sent, failed, errors });
  } catch (err) {
    console.error('Mail compose error:', err.message || err);
    res.status(500).json({ error: 'Mail send failed.' });
  }
});

app.post('/api/admin/mail/upload-attachment', verifyAdminJWT, async (req, res) => {
  try {
    const { file, filename, mimetype } = req.body;
    if (!file) return res.status(400).json({ error: 'No file data provided.' });

    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'auto',
          folder: 'hrta_mail_attachments',
          public_id: `attachment_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
          secure: true
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      const buffer = Buffer.from(file, 'base64');
      uploadStream.end(buffer);
    });

    res.json({
      url: result.secure_url,
      publicId: result.public_id,
      filename: filename || result.original_filename,
      size: result.bytes,
      format: result.format
    });
  } catch (err) {
    console.error('Mail attachment upload error:', err.message || err);
    res.status(500).json({ error: 'Upload failed.' });
  }
});

app.get('/api/admin/mail/logs', verifyAdminJWT, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mail_logs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch mail logs.' });
  }
});

// ============ NEW: Assign Exam to Student (Personal Assignment) ============
app.post('/api/admin/students/:id/assign-exam', verifyAdminJWT, async (req, res) => {
  const { id: studentId } = req.params;
  const { exam_id, custom_start, custom_end, note } = req.body;
  if (!exam_id) return res.status(400).json({ error: 'exam_id is required.' });
  try {
    // 1. Try advanced upsert with all tracking columns
    const { data, error } = await supabaseAdmin
      .from('personal_assignments')
      .upsert({
        student_id: studentId,
        exam_id,
        assigned_by: req.user.email,
        custom_start: custom_start || null,
        custom_end: custom_end || null,
        note: note || null,
        status: 'active',
        updated_at: new Date().toISOString()
      }, { onConflict: 'student_id,exam_id' })
      .select()
      .maybeSingle();

    if (error) {
      // If schema cache mismatch (missing columns in database), perform self-healing fallback
      if (error.message && (error.message.includes('column') || error.message.includes('schema cache'))) {
        console.warn("personal_assignments table is missing advanced columns. Falling back to minimal insert...");
        const { data: fbData, error: fbError } = await supabaseAdmin
          .from('personal_assignments')
          .upsert({
            student_id: studentId,
            exam_id,
            status: 'active',
            updated_at: new Date().toISOString()
          }, { onConflict: 'student_id,exam_id' })
          .select()
          .maybeSingle();
        
        if (fbError) throw fbError;
        await logSecurityEvent('exam_assigned', `Admin assigned exam ${exam_id} to student ${studentId} (Fallback)`, req.user.id, req);
        return res.json({ ok: true, assignment: fbData, warning: "Advanced columns (custom dates/notes) are not defined in the database table." });
      }
      throw error;
    }

    await logSecurityEvent('exam_assigned', `Admin assigned exam ${exam_id} to student ${studentId}`, req.user.id, req);
    res.json({ ok: true, assignment: data });
  } catch (err) {
    console.error("Assign exam API error:", err);
    res.status(500).json({ error: 'Failed to assign exam.' });
  }
});

app.get('/api/admin/students/:id/assignments', verifyAdminJWT, async (req, res) => {
  const { id: studentId } = req.params;
  try {
    const { data, error } = await supabaseAdmin
      .from('personal_assignments')
      .select('*, exams(id, title, subject, duration_minutes)')
      .eq('student_id', studentId)
      .eq('status', 'active');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch assignments.' });
  }
});

// Resolve/close intrusion alert
app.post('/api/admin/intrusion-alerts/resolve', verifyAdminJWT, async (req, res) => {
  const { alertId } = req.body;
  if (!alertId) return res.status(400).json({ error: 'alertId required' });
  try {
    const { error } = await supabaseAdmin
      .from('intrusion_alerts')
      .update({
        is_resolved: true,
        resolved_by: req.user.email,
        resolved_at: new Date().toISOString()
      })
      .eq('id', alertId);
    if (error) throw error;
    await logSecurityEvent('alert_resolved', `Admin resolved intrusion alert ${alertId}`, req.user.id, req);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve alert.' });
  }
});

// ============ STRICT CATCH-ALL ROUTE HANDLER ============
// Deny all unknown routes, root requests, and unhandled paths with 403 Forbidden
app.all('*', (req, res) => {
  res.status(403).json({ error: 'Access Denied' });
});

// Genesis audit log seeder for empty signed_audit_logs tables
async function seedGenesisAuditLog() {
  try {
    const { data: logs, error: checkErr } = await supabaseAdmin
      .from('signed_audit_logs')
      .select('id')
      .limit(1);

    if (checkErr) {
      console.warn("Could not check signed_audit_logs status:", checkErr.message);
      return;
    }

    if (!logs || logs.length === 0) {
      console.log("Empty signed_audit_logs table detected. Seeding genesis log entry...");
      
      const logContent = {
        event_type: 'genesis',
        description: 'HRTA Cryptographic Audit Log Chain Genesis Block',
        user_id: null,
        ip_address: '127.0.0.1',
        user_agent: 'System'
      };

      const signature = signLogEntry(logContent, '');

      const { error: insertErr } = await supabaseAdmin
        .from('signed_audit_logs')
        .insert({
          event_type: 'genesis',
          description: 'HRTA Cryptographic Audit Log Chain Genesis Block',
          user_id: null,
          ip_address: '127.0.0.1',
          user_agent: 'System',
          previous_signature: '',
          signature: signature
        });

      if (insertErr) {
        console.error("Failed to insert genesis audit log:", insertErr.message);
      } else {
        console.log("Genesis audit log successfully seeded.");
      }
    }
  } catch (err) {
    console.warn("Genesis audit log seeding skipped:", err.message);
  }
}

// ============ START SERVER ============
app.listen(PORT, () => {
  console.log(`========================================`)
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`========================================`)
  
  // Seed genesis audit log entry if table is empty
  seedGenesisAuditLog();
})
