import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('student')
  const [step, setStep] = useState('credentials')
  const [applicationId, setApplicationId] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [superAdminEmail, setSuperAdminEmail] = useState('')
  const [superAdminSecret, setSuperAdminSecret] = useState('')
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)

  const sendOTP = async () => {
    setLoading(true)

    try {
      let response
      let body

      if (mode === 'admin') {
        if (!adminEmail) {
          toast.error('Please enter email')
          setLoading(false)
          return
        }
        body = { email: adminEmail }
        response = await fetch('/api/send-admin-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      } else if (mode === 'superadmin') {
        if (!superAdminEmail || !superAdminSecret) {
          toast.error('Please enter email and secret key')
          setLoading(false)
          return
        }
        body = { email: superAdminEmail, secretKey: superAdminSecret }
        response = await fetch('/api/send-superadmin-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      } else {
        if (!applicationId || !dateOfBirth) {
          toast.error('Please enter Application ID and Date of Birth')
          setLoading(false)
          return
        }
        body = { applicationId, dateOfBirth }
        response = await fetch('/api/send-student-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      }

      const data = await response.json()

      if (response.ok) {
        setEmail(data.email || adminEmail || superAdminEmail)
        setStep('otp')
        toast.success('OTP sent to your email')

        let timer = 60
        setCountdown(timer)
        const interval = setInterval(() => {
          timer--
          setCountdown(timer)
          if (timer <= 0) clearInterval(interval)
        }, 1000)
      } else {
        toast.error(data.error || 'Failed to send OTP')
      }
    } catch (error) {
      toast.error('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const verifyOTP = async () => {
    if (!otp) {
      toast.error('Please enter OTP')
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp })
      })

      const data = await response.json()

      if (response.ok) {
        sessionStorage.setItem('userEmail', email)
        sessionStorage.setItem('role', data.role)
        sessionStorage.setItem('userId', data.userId)
        if (data.loginLogId) sessionStorage.setItem('loginLogId', data.loginLogId)
        sessionStorage.setItem('loginTime', new Date().toISOString())

        // Native Supabase Sign-in Sync
        try {
          const { error: authErr } = await supabase.auth.signInWithPassword({
            email: email,
            password: data.dbPassword
          });
          if (authErr) console.error("Supabase Auth Sync failed:", authErr.message);
        } catch (e) {
          console.error("Supabase Auth Sync error:", e.message);
        }

        toast.success('Login successful!')

        if (data.role === 'super_admin' || data.role === 'admin') {
          window.location.href = '/admin/dashboard'
        } else {
          window.location.href = '/student/dashboard'
        }
      } else {
        toast.error(data.error || 'Invalid OTP')
      }
    } catch (error) {
      toast.error('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const resetLogin = () => {
    setStep('credentials')
    setOtp('')
    setAdminEmail('')
    setSuperAdminEmail('')
    setSuperAdminSecret('')
    setApplicationId('')
    setDateOfBirth('')
    setEmail('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0A0E27] via-[#0A1E3D] to-[#0A0E27] p-4">
      {/* 3D Animated Background Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/5 rounded-full blur-3xl animate-float"></div>
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-accent/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/3 rounded-full blur-3xl"></div>
      </div>

      <div className="glass-card rounded-2xl p-8 w-full max-w-md relative z-10 neon-glow">
        {/* Logo and Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center neon-glow">
            <span className="text-3xl font-bold text-primary animate-glow">HRTA</span>
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            HARMAN RATHI TESTING AGENCY
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Excellence in Assessment</p>
          <div className="w-24 h-0.5 bg-gradient-to-r from-primary to-accent mx-auto mt-3"></div>
        </div>

        {step === 'credentials' ? (
          <>
            {/* Tabs */}
            <div className="flex mb-6 bg-secondary/30 rounded-lg p-1">
              {[
                { id: 'student', label: 'Student', icon: '🎓' },
                { id: 'admin', label: 'Admin', icon: '👨‍💼' },
                { id: 'superadmin', label: 'Super Admin', icon: '👑' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setMode(tab.id)}
                  className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                    mode === tab.id
                      ? 'bg-gradient-to-r from-primary to-accent text-white shadow-lg'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Student Login Form */}
            {mode === 'student' && (
              <form onSubmit={(e) => { e.preventDefault(); sendOTP() }} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium mb-2 text-foreground">Application ID</label>
                  <input
                    type="text"
                    value={applicationId}
                    onChange={(e) => setApplicationId(e.target.value.toUpperCase())}
                    placeholder="Enter your Application ID"
                    className="w-full px-4 py-3 rounded-xl bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-foreground">Date of Birth</label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-accent text-white font-semibold hover:opacity-90 transition-all duration-200 disabled:opacity-50 shadow-lg"
                >
                  {loading ? 'Sending OTP...' : 'Send OTP'}
                </button>
              </form>
            )}

            {/* Admin Login Form */}
            {mode === 'admin' && (
              <form onSubmit={(e) => { e.preventDefault(); sendOTP() }} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium mb-2 text-foreground">Email Address</label>
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="admin@hrta.com"
                    className="w-full px-4 py-3 rounded-xl bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-accent text-white font-semibold hover:opacity-90 transition-all duration-200 disabled:opacity-50 shadow-lg"
                >
                  {loading ? 'Sending OTP...' : 'Send OTP'}
                </button>
              </form>
            )}

            {/* Super Admin Login Form */}
            {mode === 'superadmin' && (
              <form onSubmit={(e) => { e.preventDefault(); sendOTP() }} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium mb-2 text-foreground">Email Address</label>
                  <input
                    type="email"
                    value={superAdminEmail}
                    onChange={(e) => setSuperAdminEmail(e.target.value)}
                    placeholder="superadmin@hrta.com"
                    className="w-full px-4 py-3 rounded-xl bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-foreground">Secret Key</label>
                  <input
                    type="password"
                    value={superAdminSecret}
                    onChange={(e) => setSuperAdminSecret(e.target.value)}
                    placeholder="Enter your secret key"
                    className="w-full px-4 py-3 rounded-xl bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-semibold hover:opacity-90 transition-all duration-200 disabled:opacity-50 shadow-lg"
                >
                  {loading ? 'Verifying...' : 'Send OTP'}
                </button>
              </form>
            )}
          </>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
                <span className="text-2xl">🔐</span>
              </div>
              <h3 className="text-lg font-semibold">Enter Verification Code</h3>
              <p className="text-xs text-muted-foreground mt-1">We've sent a 6-digit code to your email</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-foreground">OTP Code</label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter 6-digit OTP"
                maxLength={6}
                className="w-full px-4 py-3 rounded-xl bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-center text-2xl tracking-[0.5em] font-mono"
                required
              />
            </div>
            <button
              onClick={verifyOTP}
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-accent text-white font-semibold hover:opacity-90 transition-all duration-200 disabled:opacity-50 shadow-lg"
            >
              {loading ? 'Verifying...' : 'Verify & Login'}
            </button>
            {countdown > 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                Resend OTP in <span className="text-primary font-semibold">{countdown}</span> seconds
              </p>
            ) : (
              <button
                onClick={sendOTP}
                className="w-full text-center text-sm text-primary hover:underline transition-all"
              >
                Resend OTP
              </button>
            )}
            <button
              onClick={resetLogin}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-all mt-2"
            >
              ← Back to Login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
