import helmet from 'helmet';

// Configure Helmet with robust Content Security Policy and security headers
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'",
        "https://www.google.com/recaptcha/", 
        "https://www.gstatic.com/recaptcha/"
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: [
        "'self'", 
        "https://res.cloudinary.com",
        "data:", 
        "blob:"
      ],
      connectSrc: [
        "'self'", 
        "https://*.supabase.co", 
        "https://*.supabase.in", 
        "wss://*.supabase.co", 
        "wss://*.supabase.in", 
        "https://hrta-portal.onrender.com", 
        "https://generativelanguage.googleapis.com", 
        "https://www.google.com/recaptcha/",
        "https://www.gstatic.com/recaptcha/",
        "https://recaptchaenterprise.googleapis.com/",
        "https://api.cloudinary.com"
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "https://www.google.com/recaptcha/", "https://recaptcha.google.com/"],
      childSrc: ["'self'", "blob:", "https://www.google.com/recaptcha/", "https://recaptcha.google.com/"],
      mediaSrc: ["'self'", "blob:", "data:"],
      workerSrc: ["'self'", "blob:"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' }, // Maps to X-Frame-Options: DENY
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  }
});

// Custom middleware to set Permissions-Policy and clean headers
export const configureSecurityHeaders = (req, res, next) => {
  // Apply Helmet security headers
  helmetMiddleware(req, res, (err) => {
    if (err) return next(err);

    // Set Permissions-Policy (allow camera & microphone for self, deny others)
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');

    // Add X-XSS-Protection header to prevent XSS reflection attacks on legacy browsers
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Set Cross-Origin Isolation & Resource Policy headers
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    // Clean headers to prevent information exposure
    res.setHeader('Server', 'HRTA Secure Server');
    res.removeHeader('X-Powered-By');

    next();
  });
};
