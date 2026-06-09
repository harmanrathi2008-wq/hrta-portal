import { Navigate, Outlet } from 'react-router-dom'

export default function ProtectedRoute({ allowedRoles = [] }) {
  // Get user role from sessionStorage
  const role = sessionStorage.getItem('role')
  const isAuthenticated = role !== null

  // Check 4-hour absolute session expiration
  const loginTimeStr = sessionStorage.getItem('loginTime');
  if (loginTimeStr) {
    const loginTime = new Date(loginTimeStr).getTime();
    const fourHours = 4 * 60 * 60 * 1000;
    if (Date.now() - loginTime > fourHours) {
      sessionStorage.clear();
      return <Navigate to="/login?expired=true" replace />
    }
  }

  // Not logged in - redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // Check if user has required role
  if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    // Redirect to appropriate dashboard based on role
    if (role === 'admin') {
      return <Navigate to="/admin/dashboard" replace />
    }
    return <Navigate to="/student/dashboard" replace />
  }

  return <Outlet />
}
