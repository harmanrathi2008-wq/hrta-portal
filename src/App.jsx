import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { supabase } from './lib/supabase'

// Native SHA-256 helper for browser
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Global fetch interceptor for dynamic CSRF
const originalFetch = window.fetch;
window.fetch = async function (resource, options) {
  try {
    const method = (options?.method || 'GET').toUpperCase();
    const url = typeof resource === 'string' ? resource : resource?.url || '';

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      options = options || {};
      
      // Ensure options.headers is a plain object for compatibility with Capacitor and Supabase
      if (!options.headers) {
        options.headers = {};
      } else if (options.headers instanceof Headers) {
        const plain = {};
        options.headers.forEach((v, k) => {
          plain[k] = v;
        });
        options.headers = plain;
      } else if (Array.isArray(options.headers)) {
        const plain = {};
        options.headers.forEach(([k, v]) => {
          plain[k] = v;
        });
        options.headers = plain;
      }

      // Helper functions to get/set headers case-insensitively on a plain object
      const getHeader = (name) => {
        const keys = Object.keys(options.headers);
        const found = keys.find(k => k.toLowerCase() === name.toLowerCase());
        return found ? options.headers[found] : undefined;
      };

      const setHeader = (name, value) => {
        const keys = Object.keys(options.headers);
        const found = keys.find(k => k.toLowerCase() === name.toLowerCase());
        if (found) {
          options.headers[found] = value;
        } else {
          options.headers[name] = value;
        }
      };

      // Check if it's a public path
      const isPublic = [
        '/api/student/login',
        '/api/admin/login',
        '/api/send-student-otp',
        '/api/send-admin-otp',
        '/api/send-superadmin-otp',
        '/api/verify-otp',
        '/api/verify-mfa',
        '/api/setup-mfa',
        '/api/verify-recaptcha',
        '/api/health'
      ].some(p => url.includes(p));

      if (isPublic) {
        setHeader('X-CSRF-Token', 'HRTA_SECURE_CLIENT_CSRF_VAL_2026');
        setHeader('X-HRTA-SecToken', 'HRTA_SECURE_CLIENT_CSRF_VAL_2026');
      } else {
        // Authenticated path: compute dynamic CSRF
        let token = '';
        
        const authHeader = getHeader('Authorization') || '';
        if (authHeader && authHeader.startsWith('Bearer ')) {
          token = authHeader.split(' ')[1];
        }

        if (!token) {
          token = sessionStorage.getItem('studentSessionToken') || '';
        }

        if (!token) {
          try {
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            if (supabaseUrl) {
              const projectRef = supabaseUrl.split('//')[1].split('.')[0];
              const sessionStr = localStorage.getItem(`sb-${projectRef}-auth-token`);
              if (sessionStr) {
                const parsed = JSON.parse(sessionStr);
                token = parsed?.access_token || '';
              }
            }
          } catch (e) {}
        }

        if (!token) {
          token = sessionStorage.getItem('examStudentId') || sessionStorage.getItem('userId') || '';
        }

        if (token) {
          const dynamicCSRF = await sha256(token + 'HRTA_DYNAMIC_CSRF_SALT_2026');
          setHeader('X-CSRF-Token', dynamicCSRF);
          setHeader('X-HRTA-SecToken', dynamicCSRF);
        }
      }
    }
  } catch (err) {
    console.warn("Fetch interceptor non-fatal warning:", err);
  }

  return originalFetch.call(window, resource, options);
};

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
import ErrorBoundary from './components/ErrorBoundary'

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
          <Route path="/student/exam/:examId/login" element={<ErrorBoundary><ExamLogin /></ErrorBoundary>} />
          <Route path="/student/exam/:examId/instructions" element={<ErrorBoundary><ExamInstructions /></ErrorBoundary>} />
          <Route path="/student/exam/:examId/start" element={<ErrorBoundary><ExamInterface /></ErrorBoundary>} />

          {/* Fallback */}
          <Route path="*" element={<PageNotFound />} />
        </Routes>
        <Toaster position="top-right" richColors />
      </Router>
    </QueryClientProvider>
  )
}

export default App
