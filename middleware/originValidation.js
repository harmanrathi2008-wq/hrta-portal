/**
 * HRTA Portal — Server-Side Origin & Direct Access Validation Middleware
 * Validates request Origin and Referer headers against allowed frontend domains.
 * Denies direct browser HTML navigation / browsing to backend endpoints.
 */

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/(.*\.)?harmanrathiportal\.dpdns\.org$/,
  /^https:\/\/(.*\.)?hrta-portal\.pages\.dev$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(origin));
}

export function serverSideOriginValidation(req, res, next) {
  // Allow preflight OPTIONS requests to pass to CORS handler
  if (req.method === 'OPTIONS') {
    return next();
  }

  const origin = req.headers['origin'];
  const referer = req.headers['referer'];
  const fetchMode = req.headers['sec-fetch-mode'];
  const fetchDest = req.headers['sec-fetch-dest'];
  const acceptHeader = req.headers['accept'] || '';

  // 1. Direct Browser Navigation Protection
  // Reject browser requests attempting to load HTML pages or navigate directly to the backend
  const isDirectBrowserNav = (
    fetchMode === 'navigate' ||
    fetchDest === 'document' ||
    (acceptHeader.includes('text/html') && !req.path.startsWith('/api/'))
  );

  if (isDirectBrowserNav) {
    console.warn(`[Security Alert] Direct browser navigation blocked for IP ${req.realIp || req.ip}: ${req.method} ${req.originalUrl}`);
    return res.status(403).json({ error: 'Access Denied' });
  }

  // 2. Server-Side Origin Header Check
  if (origin) {
    if (!isAllowedOrigin(origin)) {
      console.warn(`[Security Alert] Forbidden Origin header '${origin}' blocked for IP ${req.realIp || req.ip}: ${req.method} ${req.originalUrl}`);
      return res.status(403).json({ error: 'Access Denied' });
    }
  }

  // 3. Server-Side Referer Header Check (if present)
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererOrigin = refererUrl.origin;
      if (!isAllowedOrigin(refererOrigin)) {
        console.warn(`[Security Alert] Forbidden Referer header '${referer}' blocked for IP ${req.realIp || req.ip}: ${req.method} ${req.originalUrl}`);
        return res.status(403).json({ error: 'Access Denied' });
      }
    } catch (e) {
      console.warn(`[Security Alert] Malformed Referer header '${referer}' blocked for IP ${req.realIp || req.ip}`);
      return res.status(403).json({ error: 'Access Denied' });
    }
  }

  next();
}
