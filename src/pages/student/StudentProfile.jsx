import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { User, Mail, Calendar, Phone, Shield, Key, LogOut, Save, Eye, EyeOff, Award, FileText } from 'lucide-react'

export default function StudentProfile() {
  const navigate = useNavigate()
  const [student, setStudent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [parentPin, setParentPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [stats, setStats] = useState({
    totalExams: 0,
    averageScore: 0,
    bestScore: 0,
    totalCorrect: 0,
    totalWrong: 0
  })
  const [profile, setProfile] = useState({
    full_name: '',
    email: '',
    phone: '',
    date_of_birth: '',
    category: '',
  })

  const studentId = sessionStorage.getItem('userId')

  useEffect(() => {
    loadStudentData()
    loadStats()
  }, [studentId])

  const loadStudentData = async () => {
    try {
      const token = sessionStorage.getItem("studentSessionToken") || '';
      const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';
      
      const response = await fetch(`${apiBaseUrl}/api/student/profile?studentId=${studentId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('Failed to fetch candidate details');
      }
      const data = await response.json();
      setStudent(data)
      setProfile({
        full_name: data.full_name || '',
        email: data.email || '',
        phone: data.phone || '',
        date_of_birth: data.date_of_birth || '',
        category: data.category || 'general',
      })
    } catch (err) {
      console.error("Error loading profile:", err);
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    const { data: results } = await supabase
      .from('exam_results')
      .select('total_score, total_marks, percentage, correct_count, wrong_count')
      .eq('student_id', studentId)
      .eq('status', 'published')

    if (results && results.length > 0) {
      const totalScore = results.reduce((sum, r) => sum + (r.total_score || 0), 0)
      const totalMarks = results.reduce((sum, r) => sum + (r.total_marks || 0), 0)
      const avgScore = results.length > 0 ? Math.round(results.reduce((sum, r) => sum + (r.percentage || 0), 0) / results.length) : 0
      const bestScore = Math.max(...results.map(r => r.percentage || 0), 0)
      const totalCorrect = results.reduce((sum, r) => sum + (r.correct_count || 0), 0)
      const totalWrong = results.reduce((sum, r) => sum + (r.wrong_count || 0), 0)

      setStats({
        totalExams: results.length,
        averageScore: avgScore,
        bestScore: bestScore,
        totalCorrect: totalCorrect,
        totalWrong: totalWrong
      })
    }
  }

  const handleUpdateProfile = async () => {
    setSaving(true)
    try {
      const token = sessionStorage.getItem("studentSessionToken") || '';
      const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';

      const response = await fetch(`${apiBaseUrl}/api/student/profile/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          studentId: studentId,
          phone: profile.phone,
          category: profile.category
        })
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to update profile.');
      }
      toast.success('Profile updated successfully')
    } catch (err) {
      toast.error(err.message || 'Failed to update profile.')
    } finally {
      setSaving(false)
    }
  }

  const handleSetParentPin = async () => {
    if (parentPin.length !== 6 || !/^\d+$/.test(parentPin)) {
      toast.error('PIN must be 6 digits')
      return
    }

    setSaving(true)
    try {
      const token = sessionStorage.getItem("studentSessionToken") || '';
      const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';

      const response = await fetch(`${apiBaseUrl}/api/student/profile/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          studentId: studentId,
          parent_pin: parentPin
        })
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to set parent PIN.');
      }
      toast.success('Parent PIN set successfully')
      setParentPin('')
    } catch (err) {
      toast.error(err.message || 'Failed to set parent PIN.')
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = () => {
    sessionStorage.clear()
    navigate('/login')
    toast.success('Logged out successfully')
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading profile...</div>
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">My Profile</h1>

      {/* Profile Card */}
      <div className="glass-card rounded-xl p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
            <User className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{profile.full_name}</h2>
            <p className="text-sm text-muted-foreground">{student?.application_id}</p>
            <p className="text-xs text-primary mt-1">{student?.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-secondary/20">
            <p className="text-xs text-muted-foreground">Date of Birth</p>
            <p className="font-medium">{profile.date_of_birth}</p>
          </div>
          <div className="p-3 rounded-lg bg-secondary/20">
            <p className="text-xs text-muted-foreground">Category</p>
            <p className="font-medium capitalize">{profile.category}</p>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Phone Number</label>
          <input
            type="tel"
            value={profile.phone}
            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            placeholder="Enter your phone number"
            className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Category</label>
          <select
            value={profile.category}
            onChange={(e) => setProfile({ ...profile, category: e.target.value })}
            className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none"
          >
            <option value="general">General</option>
            <option value="obc">OBC</option>
            <option value="sc">SC</option>
            <option value="st">ST</option>
          </select>
        </div>

        <button
          onClick={handleUpdateProfile}
          disabled={saving}
          className="w-full py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4 inline mr-2" /> Save Changes
        </button>
      </div>

      {/* Statistics Card */}
      <div className="glass-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Award className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Performance Statistics</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-secondary/20">
            <p className="text-xs text-muted-foreground">Total Exams</p>
            <p className="text-xl font-bold text-primary">{stats.totalExams}</p>
          </div>
          <div className="p-3 rounded-lg bg-secondary/20">
            <p className="text-xs text-muted-foreground">Average Score</p>
            <p className="text-xl font-bold text-green-400">{stats.averageScore}%</p>
          </div>
          <div className="p-3 rounded-lg bg-secondary/20">
            <p className="text-xs text-muted-foreground">Best Score</p>
            <p className="text-xl font-bold text-accent">{stats.bestScore}%</p>
          </div>
          <div className="p-3 rounded-lg bg-secondary/20">
            <p className="text-xs text-muted-foreground">Questions Answered</p>
            <p className="text-xl font-bold">{stats.totalCorrect + stats.totalWrong}</p>
          </div>
        </div>
      </div>

      {/* Parent Access PIN Card */}
      <div className="glass-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Parent Access PIN</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Set a 6-digit PIN for parents to view your progress. Parents can login using your Application ID + this PIN.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showPin ? 'text' : 'password'}
              value={parentPin}
              onChange={(e) => setParentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Enter 6-digit PIN"
              maxLength={6}
              className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none font-mono tracking-widest"
            />
            <button
              onClick={() => setShowPin(!showPin)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            onClick={handleSetParentPin}
            disabled={saving || parentPin.length !== 6}
            className="px-4 py-2 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
          >
            <Key className="w-4 h-4 inline mr-1" /> Set PIN
          </button>
        </div>
      </div>

      {/* Logout Button */}
      <button
        onClick={handleLogout}
        className="w-full py-2 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
      >
        <LogOut className="w-4 h-4 inline mr-2" /> Logout
      </button>
    </div>
  )
}
