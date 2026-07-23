import rateLimit from 'express-rate-limit';

// General rate limiter for all standard API routes (60 requests per 1 minute per IP)
export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
  message: { error: 'Too many requests from this IP, please try again after 1 minute.' },
  standardHeaders: true, // Return standard rate limit info headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  skip: (req) => req.path && req.path.startsWith('/api/admin/'),
});

// Stricter limiter for sensitive auth endpoints (Login, Signup, OTP generation)
// Limits requests to 5 attempts per 1 minute per IP to completely block brute-force attempts
export const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5,
  message: { error: 'Too many login or OTP attempts. Please try again in 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter for expensive database queries or file upload requests
export const heavyRequestLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Rate limit exceeded for heavy operations. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path && req.path.startsWith('/api/admin/'),
});

// Stricter rate limiter specifically for exam submissions (max 5 requests per 1 minute)
export const submitExamLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5,
  message: { error: 'You are submitting the exam too quickly. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Dedicated rate limiter for private 24/7 internal wake-up / heartbeat endpoint
export const wakeupLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 9, // max 9 requests per 60s per IP
  message: { error: 'Too Many Requests' },
  standardHeaders: true,
  legacyHeaders: false,
});


