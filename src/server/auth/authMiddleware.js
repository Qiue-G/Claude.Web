/**
 * JWT authentication and authorization middleware.
 *
 * - signToken: create a JWT for a user
 * - requireAuth: Express middleware — rejects unauthenticated requests with 401
 * - requireAdmin: Express middleware — rejects non-admin users with 403
 */
import jwt from 'jsonwebtoken';

const TOKEN_EXPIRY = '8h';

function getJwtSecret() {
  return process.env.JWT_SECRET;
}

/**
 * Sign a JWT for the given user object.
 * @param {{ id: string, username: string, role: string }} user
 * @returns {string} signed JWT
 */
export function signToken(user) {
  if (!user || !user.id || !user.username) {
    throw new Error('User must have id and username');
  }
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role || 'user' },
    getJwtSecret(),
    { expiresIn: TOKEN_EXPIRY }
  );
}

/**
 * Express middleware: requires a valid Bearer token in the Authorization header.
 * On success, sets req.user = { id, username, role } and calls next().
 * On failure, responds with 401.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required', code: 'auth_required' });
  }
  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = { id: decoded.id, username: decoded.username, role: decoded.role || 'user' };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'token_expired' });
    }
    return res.status(401).json({ error: 'Invalid token', code: 'token_invalid' });
  }
}

/**
 * Express middleware: requires admin role. Must be used after requireAuth
 * (or a middleware that sets req.user).
 */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required', code: 'admin_required' });
  }
  next();
}
