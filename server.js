import express from 'express'
import cors from 'cors'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { v2 as cloudinary } from 'cloudinary'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import nodemailer from 'nodemailer'
import axios from 'axios'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT || 8080

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// Supabase
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

// Resend - Use RESEND_API_KEY (not VITE_)
const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy')
const resendAdmin = process.env.RESEND_API_KEY_ADMIN ? new Resend(process.env.RESEND_API_KEY_ADMIN) : null
const resendStudent = process.env.RESEND_API_KEY_STUDENT ? new Resend(process.env.RESEND_API_KEY_STUDENT) : null

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

// Robust email dispatch helper with Resend first, falling back to Gmail SMTP rotation
async function sendEmail({ to, subject, html, fromName = 'HRTA', type = 'student' }) {
  // Try Resend first
  try {
    const resendClient = type === 'admin' ? (resendAdmin || resend) : (resendStudent || resend);
    const fromDomain = fromName === 'HRTA Admin' ? ADMIN_FROM_EMAIL : FROM_EMAIL;
    const response = await resendClient.emails.send({
      from: `${fromName} <${fromDomain}>`,
      to: to,
      subject: subject,
      html: html
    });
    
    if (response.error) {
      throw new Error(response.error.message || 'Resend error response');
    }
    
    console.log(`Email sent successfully via Resend to ${to}`);
    return { success: true, provider: 'resend', data: response };
  } catch (resendError) {
    console.warn(`Resend failed to send email to ${to}: ${resendError.message}. Initiating SMTP rotation fallback...`);
    
    if (transporters.length === 0) {
      throw new Error(`Resend failed, and no Gmail SMTP accounts are configured as fallback. Original error: ${resendError.message}`);
    }
    
    let lastError = null;
    for (let attempt = 0; attempt < transporters.length; attempt++) {
      const idx = (currentTransporterIndex + attempt) % transporters.length;
      const { email, transporter } = transporters[idx];
      
      try {
        console.log(`Attempting to send email via Gmail SMTP: ${email}`);
        await transporter.sendMail({
          from: `"${fromName}" <${email}>`,
          to: to,
          subject: subject,
          html: html
        });
        
        currentTransporterIndex = (idx + 1) % transporters.length;
        console.log(`Email sent successfully via Gmail SMTP [${email}] to ${to}`);
        return { success: true, provider: 'gmail_smtp', email: email };
      } catch (smtpError) {
        console.warn(`Gmail SMTP [${email}] failed: ${smtpError.message}`);
        lastError = smtpError;
      }
    }
    
    throw new Error(`All Gmail SMTP transporters failed. Last error: ${lastError ? lastError.message : 'Unknown'}. Resend error: ${resendError.message}`);
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

// ============ ADMIN OTP ============
app.post('/api/send-admin-otp', async (req, res) => {
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
      fromName: 'HRTA',
      type: 'admin'
    });
    res.json({ message: 'OTP sent successfully' })
  } catch (error) {
    console.error('Failed to send admin OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP email' })
  }
})

// ============ SUPER ADMIN OTP ============
app.post('/api/send-superadmin-otp', async (req, res) => {
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
app.post('/api/send-student-otp', async (req, res) => {
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
app.post('/api/verify-otp', async (req, res) => {
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
app.post('/api/upload-image', async (req, res) => {
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

// ============ SERVE STATIC FILES ============
app.use(express.static(join(__dirname, 'dist')))

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

// ============ START SERVER ============
app.listen(PORT, () => {
  console.log(`========================================`)
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`========================================`)
})
