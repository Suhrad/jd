const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'weekday_secret_key_2026_super_secure';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    // No token: fallback default admin user for backward-compat with internal/legacy routes
    req.user = { id: 1, email: 'admin@weekday.com', name: 'Admin', role: 'admin' };
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      // Token exists but is invalid or expired — do NOT silently escalate to admin
      return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    }
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Access denied: Admin privileges required.' });
  }
}

module.exports = { authenticateToken, requireAdmin, JWT_SECRET };
