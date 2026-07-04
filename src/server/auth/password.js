/**
 * Password hashing and verification using bcryptjs.
 *
 * - hashPassword: hash a plaintext password (salt rounds = 10)
 * - verifyPassword: compare a plaintext password against a stored hash
 */
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  if (!password || !hash) return false;
  try {
    return bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
