import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { supabase } from './lib/supabase'

// Main Login Page (JEE Main Style)
import MainLogin from './pages/MainLogin'

// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard'
import ManageStudents from './pages/admin/ManageStudents'
import ExamsList from './pages/admin/ExamsList'
import CreateExam from './pages/admin/CreateExam'
import EditExam from './pages/admin/EditExam'
import ExamQuestions from './pages/admin/ExamQuestions'
import ResultsManagement from './pages/admin/ResultsManagement'
import ReviewSubmission from './pages/admin/ReviewSubmission'
import AdminAnnouncements from './pages/admin/AdminAnnouncements'
import AdminCertificates from './pages/admin/AdminCertificates'
import StudyMaterials from './pages/admin/StudyMaterials'
import AdminScorecard from './pages/admin/AdminScorecard'
import AdminMessages from './pages/admin/AdminMessages'
import ManageSupportTickets from './pages/admin/ManageSupportTickets'

// Student Pages
import StudentDashboard from './pages/student/StudentDashboard'
import StudentExams from './pages/student/StudentExams'
import ExamInstructions from './pages/student/ExamInstructions'
import ExamInterface from './pages/student/ExamInterface'
import StudentResults from './pages/student/StudentResults'
import Leaderboard from './pages/student/Leaderboard'
import StudentProfile from './pages/student/StudentProfile'
import StudentMessages from './pages/student/StudentMessages'
import StudentMaterials from './pages/student/StudentMaterials'
import StudentTasks from './pages/student/StudentTasks'
import ExamLogin from './pages/student/ExamLogin'
import InfoHelpCenter from './pages/InfoHelpCenter'

// Components
import ProtectedRoute from './components/ProtectedRoute'
import PageNotFound from './pages/PageNotFound'

const queryClient = new QueryClient()

function App() {
  useEffect(() => {
    const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';
    
    const checkSessionAndHeartbeat = async () => {
      const loginLogId = sessionStorage.getItem('loginLogId');
      if (!loginLogId) return;

      // Send silent heartbeat to backend to keep active duration updated in login_logs
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || '';

        await fetch(`${apiBaseUrl}/api/session-heartbeat`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Session-ID': loginLogId
          },
          body: JSON.stringify({ logId: loginLogId })
        });
      } catch (err) {
        console.warn('Failed to send heartbeat', err);
      }
    };

    // Send initial heartbeat
    checkSessionAndHeartbeat();

    // Send heartbeat every 30 seconds
    const interval = setInterval(checkSessionAndHeartbeat, 30000);

    return () => clearInterval(interval);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Routes>
          {/* Main Login Page - JEE Main Style */}
          <Route path="/" element={<MainLogin />} />
          <Route path="/login" element={<MainLogin />} />

          {/* Admin Routes */}
          <Route element={<ProtectedRoute allowedRoles={['admin', 'super_admin']} />}>
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/students" element={<ManageStudents />} />
            <Route path="/admin/exams" element={<ExamsList />} />
            <Route path="/admin/exams/create" element={<CreateExam />} />
            <Route path="/admin/exams/:examId/edit" element={<EditExam />} />
            <Route path="/admin/exams/:examId/questions" element={<ExamQuestions />} />
            <Route path="/admin/results" element={<ResultsManagement />} />
            <Route path="/admin/results/:submissionId" element={<ReviewSubmission />} />
            <Route path="/admin/results/:submissionId/scorecard" element={<AdminScorecard />} />
            <Route path="/admin/announcements" element={<AdminAnnouncements />} />
            <Route path="/admin/certificates" element={<AdminCertificates />} />
            <Route path="/admin/materials" element={<StudyMaterials />} />
            <Route path="/admin/messages" element={<AdminMessages />} />
            <Route path="/admin/support" element={<ManageSupportTickets />} />
          </Route>

          {/* Student Routes */}
          <Route element={<ProtectedRoute allowedRoles={['student']} />}>
            <Route path="/student/dashboard" element={<StudentDashboard />} />
            <Route path="/student/exams" element={<StudentExams />} />
            <Route path="/student/leaderboard" element={<Leaderboard />} />
            <Route path="/student/profile" element={<StudentProfile />} />
            <Route path="/student/messages" element={<StudentMessages />} />
            <Route path="/student/materials" element={<StudentMaterials />} />
            <Route path="/student/tasks" element={<StudentTasks />} />
          </Route>

          {/* Secure Public Scorecard Route (Verifies token inside component) */}
          <Route path="/student/results" element={<StudentResults />} />
          <Route path="/info" element={<InfoHelpCenter />} />

          {/* Exam Routes (No Layout) */}
          <Route path="/student/exam/:examId/login" element={<ExamLogin />} />
          <Route path="/student/exam/:examId/instructions" element={<ExamInstructions />} />
          <Route path="/student/exam/:examId/start" element={<ExamInterface />} />

          {/* Fallback */}
          <Route path="*" element={<PageNotFound />} />
        </Routes>
        <Toaster position="top-right" richColors />
      </Router>
    </QueryClientProvider>
  )
}

export default App
