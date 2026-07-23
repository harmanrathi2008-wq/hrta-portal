/**
 * HRTA Portal — Automated Probing & Reconnaissance Protection Middleware
 * Intercepts common automated security scanner attempts, hidden file requests,
 * and unknown sensitive endpoint probes, returning 403 Forbidden without leaking server info.
 */

const PROBING_PATHS = [
  '/.env',
  '/.git',
  '/.aws',
  '/config',
  '/admin',
  '/phpmyadmin',
  '/wp-admin',
  '/wp-login',
  '/wp-config',
  '/xmlrpc.php',
  '/actuator',
  '/swagger',
  '/v2/',
  '/api/test',
  '/random',
  '/shell',
  '/eval',
  '/console',
  '/server-status',
  '/database',
  '/db',
  '/index.php',
  '/setup.php',
  '/.htaccess',
  '/.well-known/security.txt'
];

export function probingProtectionMiddleware(req, res, next) {
  const path = req.path.toLowerCase();

  // Check exact matches or prefixes for probing paths
  const isProbingAttempt = PROBING_PATHS.some(probingPath => {
    if (probingPath.endsWith('/')) {
      return path.startsWith(probingPath);
    }
    return path === probingPath || path.startsWith(probingPath + '/');
  });

  if (isProbingAttempt) {
    console.warn(`[Probing Blocked] Automated scanner path detected from IP ${req.realIp || req.ip}: ${req.method} ${req.originalUrl}`);
    return res.status(403).json({ error: 'Access Denied' });
  }

  next();
}
