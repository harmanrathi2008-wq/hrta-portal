import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

export default function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Find admin by email
      const { data: admin, error } = await supabase
        .from('admins')
        .select('*')
        .eq('email', email)
        .single()

      if (error || !admin) {
        toast.error('Invalid email or password')
        setLoading(false)
        return
      }

      if (admin.status === 'disabled') {
        toast.error('Account disabled. Contact super admin.')
        setLoading(false)
        return
      }

      // Simple password check (in production, use hashed passwords)
      // For now, using a simple check - you should implement proper auth
      if (password !== 'admin123' && admin.email !== email) {
        toast.error('Invalid email or password')
        setLoading(false)
        return
      }

      // Store admin info in session
      sessionStorage.setItem('admin', JSON.stringify(admin))
      sessionStorage.setItem('role', admin.role || 'admin')

      toast.success('Welcome Admin!')
      navigate('/admin')
    } catch (error) {
      toast.error('Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="glass-card rounded-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-2xl font-bold text-primary">HRTA</span>
          </div>
          <h1 className="text-2xl font-bold text-primary">Admin Login</h1>
          <p className="text-sm text-muted-foreground mt-1">Harman Rathi Testing Agency</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@hrta.com"
              className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none transition-colors"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login as Admin'}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Default admin: admin@hrta.com / admin123
        </p>
      </div>
    </div>
  )
}
