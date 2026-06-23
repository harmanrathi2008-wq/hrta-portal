import helmet from 'helmet';

// Configure Helmet with robust Content Security Policy and security headers
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", 
        "https://www.google.com/recaptcha/", 
        "https://www.gstatic.com/recaptcha/"
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: [
        "'self'", 
        "data:", 
        "blob:", 
        "https://res.cloudinary.com", 
        "https://*.supabase.co", 
        "https://*.cloudinary.com"
      ],
      connectSrc: [
        "'self'", 
        "https://*.supabase.co", 
        "https://*.supabase.in", 
        "https://hrta-portal.onrender.com", 
        "https://generativelanguage.googleapis.com", 
        "https://www.google.com/recaptcha/"
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "https://www.google.com/recaptcha/", "https://recaptcha.google.com/"],
      childSrc: ["'self'", "blob:", "https://www.google.com/recaptcha/", "https://recaptcha.google.com/"],
      mediaSrc: ["'self'", "blob:", "data:"],
      workerSrc: ["'self'", "blob:"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer-when-downgrade' },
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

    // Clean headers to prevent information exposure
    res.setHeader('Server', 'HRTA Secure Server');
    res.removeHeader('X-Powered-By');

    next();
  });
};
