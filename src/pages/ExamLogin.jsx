import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

export default function ExamLogin() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const [exam, setExam] = useState(null)
  const [student, setStudent] = useState(null)
  const [applicationId, setApplicationId] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [photoUrl, setPhotoUrl] = useState(null)

  useEffect(() => {
    loadExam()
  }, [examId])

  const loadExam = async () => {
    const { data } = await supabase
      .from('exams')
      .select('*')
      .eq('id', examId)
      .single()
    setExam(data)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Find student by Application ID
      const { data: studentData, error } = await supabase
        .from('students')
        .select('*')
        .eq('application_id', applicationId.toUpperCase())
        .single()

      if (error || !studentData) {
        toast.error('Invalid Application ID')
        setLoading(false)
        return
      }

      // Verify password (Date of Birth)
      if (studentData.date_of_birth !== password) {
        toast.error('Invalid Date of Birth')
        setLoading(false)
        return
      }

      // Check if account is active
      if (studentData.status === 'disabled') {
        toast.error('Account disabled. Contact administrator.')
        setLoading(false)
        return
      }

      setStudent(studentData)
      setPhotoUrl(studentData.photo_url)

      // Store exam session info
      sessionStorage.setItem('examStudentId', studentData.id)
      sessionStorage.setItem('examId', examId)

      // Redirect to instructions page
      navigate(`/student/exam/${examId}/instructions`)

    } catch (error) {
      toast.error('Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-3 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-xl">HRTA</span>
          </div>
          <h1 className="text-xl font-bold text-gray-800">HARMAN RATHI TESTING AGENCY</h1>
          <p className="text-sm text-gray-500">Excellence in Assessment</p>
          <div className="border-b border-gray-200 my-3"></div>
        </div>

        {/* System Info */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 text-center">
          <p className="text-xs text-gray-500">System Name : [C0001]</p>
          <p className="text-xs text-gray-500 mt-1">
            Contact Invigilator if the Name and Photograph displayed on the screen is not yours
          </p>
        </div>

        {/* Exam Info */}
        {exam && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 text-center">
            <p className="text-sm text-gray-600">Candidate Name: <span className="font-medium text-gray-800">—</span></p>
            <p className="text-sm text-gray-600 mt-1">Subject Name: <span className="font-medium text-gray-800">{exam.title}</span></p>
          </div>
        )}

        {/* Login Form */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Photo Preview */}
            {photoUrl && (
              <div className="flex justify-center mb-4">
                <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-blue-300">
                  <img src={photoUrl} alt="Student" className="w-full h-full object-cover" />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Application ID
              </label>
              <input
                type="text"
                value={applicationId}
                onChange={(e) => setApplicationId(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter your Application ID"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password (Date of Birth)
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="YYYY-MM-DD"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-xs text-gray-400">© All Rights Reserved - HARMAN RATHI TESTING AGENCY</p>
        </div>
      </div>
    </div>
  )
}
