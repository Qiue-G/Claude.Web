import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/server/auth/password.js';

describe('password.js', () => {
  it('should hash a password', async () => {
    const hash = await hashPassword('test-password-123');
    assert.ok(hash);
    assert.ok(hash.startsWith('$2a$') || hash.startsWith('$2b$'));
  });

  it('should verify correct password', async () => {
    const hash = await hashPassword('my-secret-password');
    const result = await verifyPassword('my-secret-password', hash);
    assert.equal(result, true);
  });

  it('should reject wrong password', async () => {
    const hash = await hashPassword('correct-password');
    const result = await verifyPassword('wrong-password', hash);
    assert.equal(result, false);
  });

  it('should reject empty password', async () => {
    const result = await verifyPassword('', 'somehash');
    assert.equal(result, false);
  });

  it('should reject null hash', async () => {
    const result = await verifyPassword('password', null);
    assert.equal(result, false);
  });

  it('should throw on empty input to hashPassword', async () => {
    await assert.rejects(async () => {
      await hashPassword('');
    }, /Password must be a non-empty string/);
  });
});
