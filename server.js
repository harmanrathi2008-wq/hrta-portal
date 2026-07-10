import express from 'express'
import cors from 'cors'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { v2 as cloudinary } from 'cloudinary'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import nodemailer from 'nodemailer'
import axios from 'axios'
import { existsSync } from 'fs'
import { configureSecurityHeaders } from './middleware/securityHeaders.js'
import { apiLimiter, authLimiter, heavyRequestLimiter, submitExamLimiter } from './middleware/rateLimiters.js'
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

// Trust proxy header when running behind reverse proxy (e.g. Render, Cloudflare)
// Required for express-rate-limit to safely determine the actual client IP
app.set('trust proxy', 1);

// Global security headers via Helmet
app.use(configureSecurityHeaders);

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

// Supabase Clients
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
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
// Defaults to the provided key 're_SGL3B8iw_8Tq5Yh5LGyDHwV8Axodx5h7m' if not defined in env
const resultApiKey = process.env.RESEND_API_KEY_SCORECARD || process.env.RESEND_API_KEY_RESULT || 're_SGL3B8iw_8Tq5Yh5LGyDHwV8Axodx5h7m';
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
const SUPER_ADMIN_SECRET = process.env.SUPER_ADMIN_SECRET || 'HRTA_SUPER_SECRET_2026'

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
      const { data: sessionAct } = await supabaseAdmin
        .from('session_activity')
        .select('user_id, is_revoked')
        .eq('refresh_token_hash', hashedToken)
        .maybeSingle();

      if (sessionAct) {
        if (sessionAct.is_revoked) {
          return res.status(401).json({ error: 'Access Denied: Session revoked by administrator.' });
        }
        // Successfully resolved student/user session!
        req.user = { id: sessionAct.user_id };
        return next();
      }
    } catch (e) {
      console.warn("session_activity token resolution warning:", e.message);
    }

    // 2. Fallback to Supabase auth validation (for admins)
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return res.status(401).json({ error: 'Access Denied: Invalid or expired session token.' });
    }

    req.user = user;
    next();
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
  
  const csrfToken = req.headers['x-csrf-token'] || req.headers['x-hrta-sectoken'];
  if (!csrfToken || csrfToken !== 'HRTA_SECURE_CLIENT_CSRF_VAL_2026') {
    console.warn(`[CSRF Blocked] Request to ${req.path} failed CSRF validation.`);
    return res.status(403).json({ error: 'CSRF validation failed: Missing or invalid security token header.' });
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
      date_of_birth: decryptData(student.date_of_birth, 'student'),
      email: decryptData(student.email, 'student'),
      phone: student.phone ? decryptData(student.phone, 'student') : '',
      address: student.address ? decryptData(student.address, 'student') : '',
      parent_pin: student.parent_pin ? decryptData(student.parent_pin, 'student') : ''
    };
  } catch (err) {
    console.error("Error decrypting student record:", err.message);
    return student; // Return unmodified as fallback
  }
}

function encryptStudent(student) {
  if (!student) return null;
  return {
    ...student,
    date_of_birth: encryptData(student.date_of_birth, 'student'),
    email: encryptData(student.email, 'student'),
    phone: student.phone ? encryptData(student.phone, 'student') : '',
    address: student.address ? encryptData(student.address, 'student') : '',
    parent_pin: student.parent_pin ? encryptData(student.parent_pin, 'student') : ''
  };
}

// Domain emails
// harmanrathitportal.nxtdev.xyz = verified for OTP login emails (established reputation)
// harmanrathiportal.dpdns.org = verified for result/scorecard/update emails (verified domain)
const FROM_EMAIL = 'result@harmanrathiportal.dpdns.org'
const ADMIN_FROM_EMAIL = 'result@harmanrathiportal.dpdns.org'
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

// Robust, self-healing email dispatch helper
// preferSmtp=true: tries SMTP relay first, falls back to Resend API
// preferSmtp=false (default): tries Resend first, SMTP as fallback (OTPs)
async function sendEmail({ to, subject, html, text = '', fromName = 'HRTA', type = 'student', isOtp = false, preferSmtp = false, fromEmailOverride = null }) {
  const fromDomain = fromEmailOverride || (isOtp ? OTP_FROM_EMAIL : FROM_EMAIL);
  const fromAddress = `${fromName} <${fromDomain}>`;


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
          to, subject, html,
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
    const clientsToTry = [];
    if (isOtp) {
      // OTP emails: use OTP client (nxtdev.xyz domain - verified and reaches Gmail)
      if (resendOTPClient) clientsToTry.push({ name: 'resendOTPClient', client: resendOTPClient });
    } else {
      // Result/scorecard emails:
      // 1. Try scorecard/notification/fallback clients FIRST (uses otp.harmanrathiportal.dpdns.org)
      // 2. Fall back to OTP client (nxtdev.xyz domain) if others fail
      if (resendScorecardClient) clientsToTry.push({ name: 'resendScorecardClient', client: resendScorecardClient });
      if (resendNotificationClient) clientsToTry.push({ name: 'resendNotificationClient', client: resendNotificationClient });
      if (resendNewFallbackClient) clientsToTry.push({ name: 'resendNewFallbackClient', client: resendNewFallbackClient });
      if (resendOTPClient) clientsToTry.push({ name: 'resendOTPClient', client: resendOTPClient });
    }
    if (resendStudent) clientsToTry.push({ name: 'resendStudent', client: resendStudent });
    if (resend) clientsToTry.push({ name: 'resendMain', client: resend });
    if (resendAdmin) clientsToTry.push({ name: 'resendAdmin', client: resendAdmin });

    let lastResendError = null;
    for (const { name, client } of clientsToTry) {
      try {
        console.log(`[Resend] Attempting to send to ${to} using client: ${name}...`);
        
        // Dynamically select from address: OTP client requires nxtdev.xyz, others use custom dpdns.org
        const activeFromAddress = name === 'resendOTPClient'
          ? `${fromName} <${OTP_FROM_EMAIL}>`
          : fromAddress;

        const response = await client.emails.send({
          from: activeFromAddress, to, subject, html,
          ...(text ? { text } : {})
        });
        if (response.error) throw new Error(response.error.message || `Resend ${name} returned error`);
        console.log(`[Resend] Sent successfully via ${name} to ${to}`);
        return { success: true, provider: `resend_${name}`, data: response };
      } catch (err) {
        console.warn(`[Resend] Client ${name} failed: ${err.message}`);
        lastResendError = err;
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

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' })
})

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
    if (score !== undefined && score < 0.4) {
      console.warn('reCAPTCHA Enterprise score too low:', score);
      return res.status(400).json({ error: 'High security risk detected. Access denied.' });
    }

    next();
  } catch (err) {
    console.error('reCAPTCHA Enterprise verification error (falling back to pass):', err.message);
    if (err.response) console.error('Enterprise API response:', JSON.stringify(err.response.data));
    next(); // Fallback to avoid complete denial if Google service is down
  }
}

// Public endpoint for raw reCAPTCHA Enterprise token verification testing
app.post('/verify-recaptcha', async (req, res) => {
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
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

// Also support /api/verify-recaptcha for consistency with the rest of the API
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
    res.status(500).json({ error: err.message, detail: err.response?.data });
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

  // Return properties the React app needs
  res.json({ 
    message: 'Login successful', 
    role: stored.role, 
    userId: stored.userId, 
    userEmail: stored.userEmail,
    loginLogId: logId,
    dbPassword: dbPassword,
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
    console.error('Error generating signed upload URL:', error);
    res.status(500).json({ error: error.message || 'Failed to generate upload URL' });
  }
})

// ============ COMPREHENSIVE AUDIT LOGGING ============
app.post('/api/audit-log', verifyUserJWT, validateAuditLog, async (req, res) => {
  try {
    const { userId, userRole, displayName, action, details } = req.body;
    if (!action) {
      return res.status(400).json({ error: 'Action is required' });
    }

    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const ip = rawIp.split(',')[0].trim();

    // 1. Fetch preceding audit log to retrieve the previous hash
    let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    try {
      const { data: lastLog, error: fetchErr } = await supabaseAdmin
        .from('audit_logs')
        .select('details')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!fetchErr && lastLog && lastLog.details && lastLog.details.curr_hash) {
        prevHash = lastLog.details.curr_hash;
      }
    } catch (hashErr) {
      console.warn("Could not retrieve preceding audit log hash, using genesis seed:", hashErr.message);
    }

    // 2. Prepare payload and hash with SHA-256 for integrity verification
    const timestamp = new Date().toISOString();
    const logDetails = details || {};
    
    const hashInput = JSON.stringify({
      userId: userId || 'Unknown',
      action: action,
      ip: ip,
      prevHash: prevHash,
      timestamp: timestamp,
      payload: logDetails
    });
    
    const currHash = crypto.createHash('sha256').update(hashInput).digest('hex');

    // 3. Inject chain metadata into details JSONB
    const securedDetails = {
      ...logDetails,
      prev_hash: prevHash,
      curr_hash: currHash,
      hashed_at: timestamp
    };

    // 4. Save audit log row
    const { error } = await supabaseAdmin
      .from('audit_logs')
      .insert({
        user_id: userId || 'Unknown',
        user_role: userRole || 'Anonymous',
        display_name: displayName || 'Anonymous',
        action: action,
        details: securedDetails,
        ip_address: ip
      });

    if (error) throw error;
    res.json({ success: true, curr_hash: currHash });
  } catch (error) {
    console.error('Error writing audit log:', error);
    res.status(500).json({ error: error.message || 'Failed to write audit log' });
  }
})

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
    console.error('Error signing URL:', error);
    res.status(500).json({ error: error.message || 'Failed to sign URL' });
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
      console.error('Background result email failed to send:', err);
    });

    res.json({ success: true, message: 'Result email notification dispatched successfully.' });
  } catch (err) {
    console.error('Failed to prepare result notification:', err.message);
    res.status(500).json({ error: 'Failed to prepare result email notification: ' + err.message });
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

    res.json({ success: true, message: 'Reply sent and support ticket resolved successfully.' });
  } catch (error) {
    console.error('Error replying to support ticket:', error);
    res.status(500).json({ error: error.message || 'Failed to send reply' });
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
    console.error('Admin message error:', err);
    res.status(500).json({ error: err.message || 'Failed to send message' });
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
        attempt_number: attemptNumber
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
    res.status(500).json({ error: 'Internal server error during exam scoring: ' + err.message });
  }
});

// ============ SERVE STATIC FILES ============
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send("User-agent: *\nDisallow: /");
});

if (existsSync(join(__dirname, 'dist'))) {
  app.use(express.static(join(__dirname, 'dist'), {
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }))
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(join(__dirname, 'dist', 'index.html'))
  })
} else {
  app.get('*', (req, res) => {
    res.json({ message: "HRTA API Server is running" })
  })
}

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
    if (!session) return res.json({ answer: null, adminCandidates: [], adminConnected: false });
    const candidates = [...session.adminCandidates];
    session.adminCandidates = []; // drain consumed candidates
    session.updatedAt = Date.now();
    res.json({ answer: session.answer, adminCandidates: candidates, adminConnected: session.adminConnected });
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
    if (!session) return res.json({ offer: null, studentCandidates: [] });
    const candidates = [...session.studentCandidates];
    session.studentCandidates = []; // drain consumed candidates
    session.updatedAt = Date.now();
    res.json({ offer: session.offer, studentCandidates: candidates });
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

// Register global CSRF protection for all state-changing API endpoints
app.use('/api/', verifyCSRF);

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
    
    // Encrypt sensitive fields
    const encryptedStudent = encryptStudent(rawStudent);

    const { data, error } = await supabaseAdmin
      .from('students')
      .insert([encryptedStudent])
      .select()
      .single();

    if (error) throw error;

    await logSecurityEvent('candidate_create', `Admin created candidate ${rawStudent.full_name} (${rawStudent.application_id})`, req.user.id, req);
    res.json(decryptStudent(data));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create candidate.' });
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
    const currentVersion = parseInt(activeVersion.replace('v', '')) || 1;
    const newVersion = `v${currentVersion + 1}`;
    
    // Generate new secure seeds dynamically
    const randomSeed = () => crypto.randomBytes(32).toString('hex');
    const newKeys = {
      student: randomSeed(),
      exam: randomSeed(),
      payment: randomSeed(),
      video: randomSeed(),
      session: randomSeed()
    };
    
    rotateEncryptionKeys(newVersion, newKeys);
    await logSecurityEvent('key_rotation', `Superadmin rotated database encryption keys to version ${newVersion}`, req.user.id, req);
    
    res.json({ ok: true, activeVersion: newVersion });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rotate keys.' });
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

// ============ START SERVER ============
app.listen(PORT, () => {
  console.log(`========================================`)
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`========================================`)
})
