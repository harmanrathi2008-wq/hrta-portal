import React, { useState, useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ProtectedRoute({ allowedRoles = [] }) {
  // Get user role from sessionStorage
  const role = sessionStorage.getItem('role')
  const isAuthenticated = role !== null

  const [isAuthReady, setIsAuthReady] = useState(false)

  useEffect(() => {
    const checkSupabaseSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          setIsAuthReady(true)
          return
        }

        // Wait for auth session to load asynchronously
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
          if (newSession) {
            subscription.unsubscribe()
            setIsAuthReady(true)
          }
        })

        // Fallback after 1 second if no session recovered
        setTimeout(() => {
          subscription.unsubscribe()
          setIsAuthReady(true)
        }, 1000)
      } catch (err) {
        console.error("Error checking Supabase session in guard:", err)
        setIsAuthReady(true)
      }
    }

    if (isAuthenticated) {
      checkSupabaseSession()
    } else {
      setIsAuthReady(true)
    }
  }, [isAuthenticated])

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

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-cyan-400 font-bold space-y-3">
        <svg className="animate-spin h-8 w-8 text-cyan-500" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span className="text-sm tracking-wider uppercase">Restoring secure session...</span>
      </div>
    )
  }

  // Check if user has required role
  if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    // Redirect to appropriate dashboard based on role
    if (role === 'admin' || role === 'super_admin') {
      return <Navigate to="/admin/dashboard" replace />
    }
    return <Navigate to="/student/dashboard" replace />
  }

  return <Outlet />
}
