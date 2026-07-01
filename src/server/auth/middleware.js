/**
 * Authentication middleware for admin token validation.
 *
 * Usage:
 *   import { requireAdmin } from './auth/middleware.js';
 *   router.get('/admin/sessions', requireAdmin, handler);
 *
 * The admin token is set via ADMIN_TOKEN environment variable.
 * If not set, admin endpoints are disabled (return 501).
 */
import { AppError } from '../lib/AppError.js';

/**
 * Middleware that validates the admin token from the Authorization header.
 * Expects: Authorization: Bearer <admin-token>
 */
export function requireAdmin(req, res, next) {
  const adminToken = process.env.ADMIN_TOKEN;

  if (!adminToken) {
    throw new AppError(501, 'Admin endpoints disabled. Set ADMIN_TOKEN to enable.', {
      code: 'admin_disabled'
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, 'Missing or invalid Authorization header', {
      code: 'auth_required'
    });
  }

  const token = authHeader.slice(7);
  if (token !== adminToken) {
    throw new AppError(403, 'Invalid admin token', {
      code: 'admin_forbidden'
    });
  }

  next();
}
