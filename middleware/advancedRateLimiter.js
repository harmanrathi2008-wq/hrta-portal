import crypto from 'crypto';

// In-memory token bucket/sliding-window rate limiter
// Key format: type:identifier
const rateLimitCache = new Map();

// Periodic cleanup of expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitCache.entries()) {
    if (now > record.resetTime) {
      rateLimitCache.delete(key);
    }
  }
}, 5 * 60 * 1000).unref(); // Use unref() to not keep the event loop alive unnecessarily

/**
 * Multi-dimensional rate limiter
 * Limits requests based on: IP, User ID, Session, Fingerprint, Country, and ASN.
 */
export function advancedRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000; // default 1 minute
  const max = options.max || 20; // default 20 requests per window
  const blockDurationMs = options.blockDurationMs || 5 * 60 * 1000; // default 5 minutes block on breach

  return (req, res, next) => {
    const now = Date.now();

    // 1. Gather all dimensions
    const clientIp = req.headers['cf-connecting-ip'] || req.ip || 'unknown-ip';
    const userId = req.user?.id || 'anonymous';
    const sessionId = req.headers['x-session-id'] || 'no-session';
    const userAgent = req.headers['user-agent'] || '';
    const fingerprint = req.headers['x-fingerprint'] || crypto.createHash('sha256').update(clientIp + userAgent).digest('hex');
    const country = req.headers['cf-ipcountry'] || 'unknown-country';
    const asn = req.headers['cf-ipasn'] || 'unknown-asn';

    // 2. Define the tracking keys
    const trackingKeys = [
      `ip:${clientIp}`,
      `user:${userId}`,
      `session:${sessionId}`,
      `fingerprint:${fingerprint}`,
      `country_asn:${country}:${asn}`
    ];

    // Check if any dimension is currently blocked
    for (const key of trackingKeys) {
      // Anonymous user-level or no-session-level skip to prevent collating all guest traffic
      if (key === 'user:anonymous' || key === 'session:no-session') continue;
      
      const record = rateLimitCache.get(key);
      if (record && record.blockedUntil && now < record.blockedUntil) {
        // Record log to console/alerts if needed
        console.warn(`[Rate Limiter Block] Dimension ${key} is currently blocked.`);
        return res.status(429).json({
          error: 'Rate limit exceeded. Temporary access block is active.',
          resetTime: new Date(record.blockedUntil).toISOString()
        });
      }
    }

    // 3. Process requests and update window
    let limitBreached = false;
    let breachedKey = '';

    for (const key of trackingKeys) {
      if (key === 'user:anonymous' || key === 'session:no-session') continue;

      let record = rateLimitCache.get(key);
      if (!record || now > record.resetTime) {
        // Initialize/reset window
        record = {
          count: 1,
          resetTime: now + windowMs,
          blockedUntil: 0
        };
        rateLimitCache.set(key, record);
      } else {
        record.count++;
        // If limit is breached, block the key
        if (record.count > max) {
          record.blockedUntil = now + blockDurationMs;
          limitBreached = true;
          breachedKey = key;
        }
      }
    }

    if (limitBreached) {
      console.warn(`[Rate Limiter Breach] Rate limit breached on key: ${breachedKey}`);
      return res.status(429).json({
        error: 'Too many requests. Access temporarily blocked.',
        resetTime: new Date(now + blockDurationMs).toISOString()
      });
    }

    next();
  };
}
