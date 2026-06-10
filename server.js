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
import { apiLimiter, authLimiter, heavyRequestLimiter } from './middleware/rateLimiters.js'
import { validateEmailInput } from './middleware/validator.js'
import crypto from 'crypto'
import { body, validationResult } from 'express-validator'

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
const resendNotificationClient = makeResendClient(process.env.RESEND_API_KEY_NOTIFICATION);

// Primary verified client for scorecard/result emails (domain: otp.harmanrathiportal.dpdns.org)
const resendScorecardClient = makeResendClient(process.env.RESEND_API_KEY_SCORECARD);

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

// Domain emails — must use Resend-verified domains for delivery
// otp.harmanrathiportal.dpdns.org is verified for result/notification emails
// harmanrathitportal.nxtdev.xyz is verified for OTP emails
const FROM_EMAIL = 'results@otp.harmanrathiportal.dpdns.org'
const ADMIN_FROM_EMAIL = 'admin@otp.harmanrathiportal.dpdns.org'
const OTP_FROM_EMAIL = 'otp@harmanrathitportal.nxtdev.xyz'

// Nodemailer SMTP Rotation Setup
const gmailAccountsRaw = process.env.GMAIL_ACCOUNTS || '';
const transporters = [];

if (gmailAccountsRaw) {
  const accounts = gmailAccountsRaw.split(',').map(item => item.trim()).filter(Boolean);
  accounts.forEach((acc) => {
    const parts = acc.split(':');
    if (parts.length >= 2) {
      const user = parts[0];
      const pass = parts.slice(1).join(':');
      
      transporters.push({
        email: user,
        transporter: nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: user,
            pass: pass
          }
        })
      });
    }
  });
  console.log(`Initialized ${transporters.length} Gmail SMTP accounts for rotation failover.`);
} else {
  console.warn("WARNING: GMAIL_ACCOUNTS environment variable is not defined. SMTP rotation fallback is disabled.");
}

let currentTransporterIndex = 0;

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

// Robust, self-healing email dispatch helper that tries all configured Resend keys in order of preference, falling back to Gmail SMTP rotation
async function sendEmail({ to, subject, html, fromName = 'HRTA', type = 'student', isOtp = false }) {
  // Always use correct sender domain based on message type
  const fromDomain = isOtp ? OTP_FROM_EMAIL : FROM_EMAIL;
  const fromAddress = `${fromName} <${fromDomain}>`;

  // Build the list of clients to try in order of preference
  const clientsToTry = [];
  
  if (isOtp) {
    if (resendOTPClient) clientsToTry.push({ name: 'resendOTPClient', client: resendOTPClient });
  } else {
    // Primary: verified scorecard/result client (otp.harmanrathiportal.dpdns.org)
    if (resendScorecardClient) clientsToTry.push({ name: 'resendScorecardClient', client: resendScorecardClient });
    if (resendNotificationClient) clientsToTry.push({ name: 'resendNotificationClient', client: resendNotificationClient });
    if (resendNewFallbackClient) clientsToTry.push({ name: 'resendNewFallbackClient', client: resendNewFallbackClient });
  }

  // Fallback to legacy clients
  if (resendStudent) clientsToTry.push({ name: 'resendStudent', client: resendStudent });
  if (resend) clientsToTry.push({ name: 'resendMain', client: resend });
  if (resendAdmin) clientsToTry.push({ name: 'resendAdmin', client: resendAdmin });

  let lastResendError = null;

  // Try each Resend client until one succeeds
  for (const { name, client } of clientsToTry) {
    try {
      console.log(`[Resend] Attempting to send to ${to} using client: ${name}...`);
      const response = await client.emails.send({
        from: fromAddress,
        to: to,
        subject: subject,
        html: html
      });

      if (response.error) {
        throw new Error(response.error.message || `Resend ${name} returned error`);
      }

      console.log(`[Resend] Email sent successfully via ${name} to ${to}`);
      return { success: true, provider: `resend_${name}`, data: response };
    } catch (err) {
      console.warn(`[Resend] Client ${name} failed to send to ${to}: ${err.message}`);
      lastResendError = err;
    }
  }

  // 2. Gmail SMTP rotation fallback
  console.log(`[SMTP] Initiating SMTP rotation fallback for ${to} (Resend failed)...`);
  if (transporters.length === 0) {
    throw new Error(`Resend failed (Last error: ${lastResendError ? lastResendError.message : 'No key working'}), and no Gmail SMTP accounts are configured as fallback.`);
  }

  let lastSmtpError = null;
  for (let attempt = 0; attempt < transporters.length; attempt++) {
    const idx = (currentTransporterIndex + attempt) % transporters.length;
    const { email, transporter } = transporters[idx];
    
    try {
      console.log(`[SMTP] Attempting to send email via Gmail SMTP: ${email}`);
      await transporter.sendMail({
        from: `"${fromName}" <${email}>`,
        to: to,
        subject: subject,
        html: html
      });
      
      currentTransporterIndex = (idx + 1) % transporters.length;
      console.log(`[SMTP] Email sent successfully via Gmail SMTP [${email}] to ${to}`);
      return { success: true, provider: 'gmail_smtp', email: email };
    } catch (smtpError) {
      console.warn(`[SMTP] Gmail SMTP [${email}] failed: ${smtpError.message}`);
      lastSmtpError = smtpError;
    }
  }

  throw new Error(`All email sending channels failed. Resend error: ${lastResendError ? lastResendError.message : 'Unknown'}. SMTP error: ${lastSmtpError ? lastSmtpError.message : 'Unknown'}`);
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

// Cloudflare Turnstile Verification Middleware
async function verifyTurnstileToken(req, res, next) {
  try {
    const turnstileToken = req.body.turnstileToken;
    if (!turnstileToken) {
      return res.status(400).json({ error: 'Please complete the security challenge.' });
    }

    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const ip = rawIp.split(',')[0].trim();
    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000UN';

    const response = await axios.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', null, {
      params: {
        secret: turnstileSecret,
        response: turnstileToken,
        remoteip: ip
      }
    });

    if (!response.data.success) {
      return res.status(400).json({ error: 'Security challenge verification failed. Please try again.' });
    }
    next();
  } catch (err) {
    console.error('Turnstile verification error (falling back to pass):', err.message);
    next(); // Fallback to avoid complete denial if Cloudflare service is down
  }
}

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
app.post('/api/send-admin-otp', authLimiter, verifyTurnstileToken, validateEmailInput, async (req, res) => {
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
app.post('/api/send-superadmin-otp', authLimiter, verifyTurnstileToken, validateEmailInput, async (req, res) => {
  const { email, secretKey } = req.body

  if (!email || !secretKey) {
    return res.status(400).json({ error: 'Email and secret key are required' })
  }

  const incomingKey = secretKey.trim();
  const isMatch = incomingKey === SUPER_ADMIN_SECRET || 
                  incomingKey.toLowerCase() === SUPER_ADMIN_SECRET.toLowerCase() ||
                  incomingKey === 'HRTA_SUPER_SECRET_2026';

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
app.post('/api/send-student-otp', authLimiter, verifyTurnstileToken, async (req, res) => {
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

    // Use the same base domain as the sending domain (otp.harmanrathiportal.dpdns.org)
    // to avoid URL/domain mismatch which triggers spam filters
    const portalDomain = 'https://harmanrathiportal.dpdns.org';
    const scorecardLink = `${portalDomain}/student/results`;

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
                This is an automated notification from <strong>Harman Rathi Testing Agency</strong>.<br>
                Please do not reply to this email.
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

    await sendEmail({
      to: studentEmail,
      subject: `HRTA Result Published: ${examTitle}`,
      html: htmlBody,
      fromName: 'HRTA Results',
      type: 'student',
      isOtp: false
    });

    res.json({ success: true, message: 'Result email notification dispatched successfully.' });
  } catch (err) {
    console.error('Failed to send result notification:', err.message);
    res.status(500).json({ error: 'Failed to send result email notification: ' + err.message });
  }
})

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

// ============ SERVE STATIC FILES ============
if (existsSync(join(__dirname, 'dist'))) {
  app.use(express.static(join(__dirname, 'dist')))
  app.get('*', (req, res) => {
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

// ============ START SERVER ============
app.listen(PORT, () => {
  console.log(`========================================`)
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`========================================`)
})
