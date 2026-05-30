import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

export default function StudentLogin() {
  const [applicationId, setApplicationId] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Find student by Application ID
      const { data: student, error } = await supabase
        .from('students')
        .select('*')
        .eq('application_id', applicationId.toUpperCase())
        .single()

      if (error || !student) {
        toast.error('Invalid Application ID')
        setLoading(false)
        return
      }

      // Verify Date of Birth
      if (student.date_of_birth !== dateOfBirth) {
        toast.error('Invalid Date of Birth')
        setLoading(false)
        return
      }

      // Check if account is disabled
      if (student.status === 'disabled') {
        toast.error('Account disabled. Contact administrator.')
        setLoading(false)
        return
      }

      // Store student info in session
      sessionStorage.setItem('student', JSON.stringify(student))
      sessionStorage.setItem('role', 'student')

      toast.success('Login successful!')
      navigate('/student')
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
          <h1 className="text-2xl font-bold text-primary">HARMAN RATHI TESTING AGENCY</h1>
          <p className="text-sm text-muted-foreground mt-1">Student Login</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Application ID</label>
            <input
              type="text"
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value.toUpperCase())}
              placeholder="Enter your Application ID (e.g., HRTA001)"
              className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Date of Birth</label>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none transition-colors"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Contact administrator if you don't have your Application ID or DOB
        </p>
      </div>
    </div>
  )
}
