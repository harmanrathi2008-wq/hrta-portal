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

// Components
import ProtectedRoute from './components/ProtectedRoute'
import PageNotFound from './pages/PageNotFound'

const queryClient = new QueryClient()

function App() {
  useEffect(() => {
    const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';
    
    const checkSessionAndHeartbeat = async () => {
      const loginLogId = sessionStorage.getItem('loginLogId');
      const loginTimeStr = sessionStorage.getItem('loginTime');
      if (!loginLogId || !loginTimeStr) return;

      // 1. Client-side absolute 4-hour expiry check
      const loginTime = new Date(loginTimeStr).getTime();
      const fourHours = 4 * 60 * 60 * 1000;
      if (Date.now() - loginTime > fourHours) {
        console.warn("Session expired on client-side (4-hour limit). Logging out.");
        sessionStorage.clear();
        await supabase.auth.signOut();
        window.location.href = '/?expired=true';
        return;
      }

      // 2. Send heartbeat to backend with secure headers
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || '';

        const res = await fetch(`${apiBaseUrl}/api/session-heartbeat`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Session-ID': loginLogId
          },
          body: JSON.stringify({ logId: loginLogId })
        });

        if (res.status === 401) {
          const data = await res.json().catch(() => ({}));
          console.warn(`Session rejected by backend: ${data.error || 'unauthorized'}. Logging out.`);
          sessionStorage.clear();
          await supabase.auth.signOut().catch(() => {});
          const param = data.error === 'session_expired' ? 'expired=true' : 'concurrent=true';
          window.location.href = `/?${param}`;
        }
      } catch (err) {
        console.warn('Failed to send heartbeat', err);
      }
    };

    // Send initial heartbeat & check
    checkSessionAndHeartbeat();

    // Check session and send heartbeat every 30 seconds
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
          </Route>

          {/* Student Routes */}
          <Route element={<ProtectedRoute allowedRoles={['student']} />}>
            <Route path="/student/dashboard" element={<StudentDashboard />} />
            <Route path="/student/exams" element={<StudentExams />} />
            <Route path="/student/results" element={<StudentResults />} />
            <Route path="/student/leaderboard" element={<Leaderboard />} />
            <Route path="/student/profile" element={<StudentProfile />} />
            <Route path="/student/messages" element={<StudentMessages />} />
            <Route path="/student/materials" element={<StudentMaterials />} />
            <Route path="/student/tasks" element={<StudentTasks />} />
          </Route>

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
