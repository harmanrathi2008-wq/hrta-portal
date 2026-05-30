import { Navigate, Outlet } from 'react-router-dom'

export default function ProtectedRoute({ allowedRoles = [] }) {
  // Get user role from sessionStorage
  const role = sessionStorage.getItem('role')
  const isAuthenticated = role !== null

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
