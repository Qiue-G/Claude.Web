/**
 * Auth Store - manages user authentication state
 *
 * Stores JWT token and user info in localStorage.
 * On app startup, checks if stored token is still valid via /api/auth/me.
 */
import { writable, derived } from 'svelte/store';
import { getMe } from '$apis/auth.api.js';

// Keys for localStorage
const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY = 'auth_user';

function load(key) {
  try { return localStorage.getItem(key) || null; } catch { return null; }
}

function save(key, val) {
  try {
    if (val) localStorage.setItem(key, val);
    else localStorage.removeItem(key);
  } catch { /* ignore */ }
}

// User object: { id, username, role } or null
export const authUser = writable(JSON.parse(load(AUTH_USER_KEY)));

// JWT token string or null
export const authToken = writable(load(AUTH_TOKEN_KEY));

// Derived: is the user authenticated?
export const isAuthenticated = derived(authToken, $t => !!$t);

// Persist to localStorage
authToken.subscribe(val => save(AUTH_TOKEN_KEY, val));
authUser.subscribe(val => save(AUTH_USER_KEY, JSON.stringify(val)));

/**
 * Validate stored token on startup.
 * If the token is expired/invalid, clears auth state.
 */
export async function validateStoredToken() {
  const token = load(AUTH_TOKEN_KEY);
  if (!token) return false;

  try {
    const data = await getMe(token);
    authUser.set(data.user);
    return true;
  } catch {
    // Token expired or invalid
    authToken.set(null);
    authUser.set(null);
    return false;
  }
}

/**
 * Set auth state after successful login/register.
 * @param {string} token - JWT token
 * @param {{ id: string, username: string, role: string }} user - User object
 */
export function setAuth(token, user) {
  authToken.set(token);
  authUser.set(user);
}

/**
 * Clear auth state on logout.
 */
export function clearAuth() {
  authToken.set(null);
  authUser.set(null);
}
