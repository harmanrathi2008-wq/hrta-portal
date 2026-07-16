import { supabase } from './supabase';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';

// Native SHA-256 helper for browser
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const PUBLIC_PATHS = [
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
];

let refreshPromise = null;

async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      // Get session refreshes the token if expired or close to expiry under the hood
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        sessionStorage.setItem('studentSessionToken', session.access_token);
        return session.access_token;
      }
    } catch (err) {
      console.error('API Client session refresh failed:', err);
    } finally {
      refreshPromise = null;
    }
    return null;
  })();
  return refreshPromise;
}

export async function apiClient(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();

  // Initialize headers
  const headers = options.headers instanceof Headers 
    ? new Headers(options.headers) 
    : new Headers(options.headers || {});

  // 1. Set Content-Type if not present and body is a string (default JSON helper)
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // 2. Resolve token
  let token = sessionStorage.getItem('studentSessionToken');
  if (!token) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token || '';
      if (token) {
        sessionStorage.setItem('studentSessionToken', token);
      }
    } catch (e) {}
  }

  // 3. Inject Authorization & session identification headers
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const loginLogId = sessionStorage.getItem('loginLogId');
  if (loginLogId && !headers.has('X-Session-ID')) {
    headers.set('X-Session-ID', loginLogId);
  }

  const studentId = sessionStorage.getItem('examStudentId') || sessionStorage.getItem('userId');
  if (studentId && !headers.has('x-student-id')) {
    headers.set('x-student-id', studentId);
  }

  // 4. Inject CSRF Token
  const path = endpoint.split('?')[0];
  const isPublic = PUBLIC_PATHS.some(p => path.includes(p));

  if (isPublic) {
    headers.set('X-CSRF-Token', 'HRTA_SECURE_CLIENT_CSRF_VAL_2026');
  } else {
    // Authenticated path: compute dynamic CSRF
    const csrfSeed = token || studentId || 'anonymous';
    const dynamicCSRF = await sha256(csrfSeed + 'HRTA_DYNAMIC_CSRF_SALT_2026');
    headers.set('X-CSRF-Token', dynamicCSRF);
  }

  // Set updated headers back to options
  options.headers = headers;

  // 5. Execute fetch
  let response = await fetch(url, options);

  // 6. Silent self-healing re-auth for 401 errors
  if (response.status === 401 && !isPublic) {
    console.warn(`apiClient detected 401 Unauthorized for ${path}. Retrying after token refresh...`);
    const newToken = await refreshSession();
    if (newToken) {
      // Retry with new token
      const retryHeaders = new Headers(options.headers);
      retryHeaders.set('Authorization', `Bearer ${newToken}`);
      
      // Update dynamic CSRF since the token changed
      const dynamicCSRF = await sha256(newToken + 'HRTA_DYNAMIC_CSRF_SALT_2026');
      retryHeaders.set('X-CSRF-Token', dynamicCSRF);

      options.headers = retryHeaders;
      response = await fetch(url, options);
    }
  }

  return response;
}
