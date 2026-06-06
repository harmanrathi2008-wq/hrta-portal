import rateLimit from 'express-rate-limit';

// General rate limiter for all standard API routes (100 requests per 15 minutes per IP)
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true, // Return standard rate limit info headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
});

// Stricter limiter for sensitive auth endpoints (Login, Signup, OTP generation)
// Limits requests to 5 attempts per 5 minutes per IP to prevent OTP spam and brute-force
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  message: { error: 'Too many login or OTP attempts. Please try again in 5 minutes.' },
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
});
