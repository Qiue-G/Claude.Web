/**
 * Auth API - handles user registration, login, and profile retrieval
 */
import { api } from '$lib/api.js';

/**
 * Register a new user.
 * First user to register becomes admin.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ user: { id: string, username: string, role: string }, token: string, sessionId: string, sessionToken: string }>}
 */
export async function register(username, password) {
  return api.post('/api/auth/register', { username, password });
}

/**
 * Login with existing credentials.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ user: { id: string, username: string, role: string }, token: string, sessionId: string, sessionToken: string }>}
 */
export async function login(username, password) {
  return api.post('/api/auth/login', { username, password });
}

/**
 * Get current user info. Requires Authorization header (set by api wrapper via options).
 * @param {string} token - JWT token
 * @returns {Promise<{ user: { id: string, username: string, role: string } }>}
 */
export async function getMe(token) {
  return api.get('/api/auth/me', {
    noToast: true,
    headers: { Authorization: `Bearer ${token}` }
  });
}

/**
 * Logout. Client-side: discard the token.
 * @returns {Promise<{ message: string }>}
 */
export async function logout() {
  return api.post('/api/auth/logout');
}
