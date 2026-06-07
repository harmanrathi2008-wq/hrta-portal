import { Resend } from 'resend'

const resend = new Resend(process.env.VITE_RESEND_API_KEY)

// Store OTPs temporarily (in production, use Redis or database)
const otpStore = new Map()

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email } = req.body

  if (!email) {
    return res.status(400).json({ error: 'Email is required' })
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = Date.now() + 5 * 60 * 1000 // 5 minutes

  otpStore.set(email, { otp, expiresAt })

  try {
    await resend.emails.send({
      from: 'HRTA <notifications@harmanrathitportal.nxtdev.xyz>',
      to: email,
      subject: 'Your Login OTP',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #00D4FF;">HARMAN RATHI TESTING AGENCY</h2>
          <p>Your OTP for login is:</p>
          <h1 style="font-size: 32px; letter-spacing: 5px; color: #D4AF37;">${otp}</h1>
          <p>This OTP is valid for 5 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      `
    })

    res.status(200).json({ message: 'OTP sent successfully' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to send OTP' })
  }
}
