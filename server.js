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

// Restrict CORS origins securely
const allowedOrigins = [
  'http://localhost:5173', // Vite local development server
  'https://harmanrathitportal.nxtdev.xyz', // Candidate portal
  'https://admin.harmanrathitestingagency.nxtdev.xyz' // Admin dashboard
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
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
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
)

// Resend - Robust initialization supporting VITE_ fallback and filtering out bad environment strings ("undefined", "null")
const mainResendKey = (process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY || '').trim();
const resend = new Resend(mainResendKey && mainResendKey !== 'undefined' && mainResendKey !== 'null' ? mainResendKey : 're_dummy');

const adminResendKey = (process.env.RESEND_API_KEY_ADMIN || '').trim();
const resendAdmin = (adminResendKey && adminResendKey !== 'undefined' && adminResendKey !== 'null') 
  ? new Resend(adminResendKey) 
  : null;

const studentResendKey = (process.env.RESEND_API_KEY_STUDENT || '').trim();
const resendStudent = (studentResendKey && studentResendKey !== 'undefined' && studentResendKey !== 'null') 
  ? new Resend(studentResendKey) 
  : null;

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

// Domain emails
const FROM_EMAIL = process.env.FROM_EMAIL_STUDENT || 'notifications@harmanrathitportal.nxtdev.xyz'
const ADMIN_FROM_EMAIL = process.env.FROM_EMAIL_ADMIN || 'admin@harmanrathitportal.nxtdev.xyz'

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
async function sendEmail({ to, subject, html, fromName = 'HRTA', type = 'student' }) {
  // Always use FROM_EMAIL (e.g. notifications@harmanrathitportal.nxtdev.xyz) to ensure the domain matches Resend's verified single sender or domain records
  const fromDomain = FROM_EMAIL;
  const fromAddress = `${fromName} <${fromDomain}>`;

  // Build the list of clients to try in order of preference
  const clientsToTry = [];
  
  if (type === 'admin') {
    if (resendAdmin) clientsToTry.push({ name: 'resendAdmin', client: resendAdmin });
    if (resend) clientsToTry.push({ name: 'resendMain', client: resend });
    if (resendStudent) clientsToTry.push({ name: 'resendStudent', client: resendStudent });
  } else {
    if (resendStudent) clientsToTry.push({ name: 'resendStudent', client: resendStudent });
    if (resend) clientsToTry.push({ name: 'resendMain', client: resend });
    if (resendAdmin) clientsToTry.push({ name: 'resendAdmin', client: resendAdmin });
  }

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

// ============ ADMIN OTP ============
app.post('/api/send-admin-otp', authLimiter, validateEmailInput, async (req, res) => {
  const { email } = req.body

  if (!email) {
    return res.status(400).json({ error: 'Email is required' })
  }

  const cleanEmail = email.trim();
  const { data: admins, error } = await supabase
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
      type: 'admin'
    });
    res.json({ message: 'OTP sent successfully' })
  } catch (error) {
    console.error('Failed to send admin OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP email' })
  }
})

// ============ SUPER ADMIN OTP ============
app.post('/api/send-superadmin-otp', authLimiter, validateEmailInput, async (req, res) => {
  const { email, secretKey } = req.body

  if (!email || !secretKey) {
    return res.status(400).json({ error: 'Email and secret key are required' })
  }

  if (secretKey !== SUPER_ADMIN_SECRET) {
    return res.status(401).json({ error: 'Invalid secret key' })
  }

  const cleanEmail = email.trim();
  const { data: admins, error } = await supabase
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
      type: 'admin'
    });
    res.json({ message: 'OTP sent successfully' })
  } catch (error) {
    console.error('Failed to send super admin OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP email' })
  }
})

// ============ STUDENT OTP ============
app.post('/api/send-student-otp', authLimiter, async (req, res) => {
  const { applicationId, dateOfBirth } = req.body

  if (!applicationId || !dateOfBirth) {
    return res.status(400).json({ error: 'Application ID and Date of Birth are required' })
  }

  const cleanAppId = applicationId.trim()
  
  // Find student by application_id case-insensitively
  const { data: students, error: dbError } = await supabase
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
      type: 'student'
    });
    res.json({ message: 'OTP sent successfully' })
  } catch (error) {
    console.error('Failed to send student OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP' })
  }
})

// ============ VERIFY OTP (BULLETPROOF) ============
app.post('/api/verify-otp', authLimiter, async (req, res) => {
  // Support both 'identifier' and legacy 'email' from frontend payload
  const incomingIdentifier = req.body.identifier || req.body.email;
  const otp = req.body.otp;

  if (!incomingIdentifier || !otp) {
    return res.status(400).json({ error: 'Identifier and OTP are required' })
  }

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
    return res.status(400).json({ error: 'Invalid OTP' })
  }

  // Clear OTP to prevent replay attacks
  otpStore.delete(lookupKey)

  console.log(`User verified successfully: Role [${stored.role}] ID [${stored.userId}]`)

  // Capture IP Address & Log to Database
  const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
  const ip = rawIp.split(',')[0].trim();

  let logId = null;
  try {
    const { data: logData, error: logErr } = await supabase
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
  } catch (dbErr) {
    console.error("Exception inserting login log:", dbErr.message);
  }

  // Return the exact properties the React app needs to assign the dashboard route
  res.json({ 
    message: 'Login successful', 
    role: stored.role, 
    userId: stored.userId, 
    userEmail: stored.userEmail,
    loginLogId: logId
  })
})

// ============ SESSION HEARTBEAT ============
app.post('/api/session-heartbeat', async (req, res) => {
  const { logId } = req.body;
  if (!logId) {
    return res.status(400).json({ error: 'Log ID is required' });
  }
  
  try {
    const { data: log, error: fetchErr } = await supabase
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
    
    const { error: updateErr } = await supabase
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
app.post('/api/upload-image', heavyRequestLimiter, async (req, res) => {
  const { image } = req.body

  if (!image) {
    return res.status(400).json({ error: 'Image is required' })
  }

  try {
    const result = await cloudinary.uploader.upload(image, {
      folder: 'hrta_questions',
      upload_preset: process.env.CLOUDINARY_UPLOAD_PRESET,
      transformation: [
        { width: 800, crop: 'limit' },
        { quality: 'auto:best' },
        { fetch_format: 'webp' }
      ]
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
app.post('/api/delete-image', async (req, res) => {
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
app.post('/api/get-upload-url', async (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required.' });
    }

    if (!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ 
        error: 'Database Configuration Error: VITE_SUPABASE_SERVICE_ROLE_KEY is missing on Render. Please add it to your Render dashboard Environment Variables.' 
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

// ============ ADMIN MESSAGE SENDER ============
app.post('/api/admin-message', async (req, res) => {
  try {
    const { students, subject, message, pdfUrl, pdfFileName } = req.body;

    if (!students || students.length === 0) {
      return res.status(400).json({ error: 'No recipients specified.' });
    }
    if (!subject) {
      return res.status(400).json({ error: 'Subject is required.' });
    }

    // Pick the best available Resend instance
    const mailer = resendStudent || resend;
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

      // Attach PDF if small enough (< 40MB)
      const emailPayload = {
        from: `HRTA Notifications <${fromEmail}>`,
        to: [student.email],
        subject: `[HRTA] ${subject}`,
        html: htmlBody,
      };

      try {
        const { error: sendError } = await mailer.emails.send(emailPayload);
        if (sendError) {
          errors.push(`${student.full_name}: ${sendError.message}`);
        } else {
          results.push(student.full_name);
        }
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
