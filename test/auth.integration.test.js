import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

// 直接测试工具函数
describe('Auth Integration', () => {
  let passwordModule;
  let authMiddleware;

  before(async () => {
    passwordModule = await import('../src/server/auth/password.js');
    authMiddleware = await import('../src/server/auth/authMiddleware.js');
  });

  describe('password module', () => {
    it('should hash and verify password', async () => {
      const hash = await passwordModule.hashPassword('test-password-123');
      assert.ok(hash);
      const valid = await passwordModule.verifyPassword('test-password-123', hash);
      assert.equal(valid, true);
    });

    it('should reject wrong password', async () => {
      const hash = await passwordModule.hashPassword('correct-pass');
      const valid = await passwordModule.verifyPassword('wrong-pass', hash);
      assert.equal(valid, false);
    });
  });

  describe('auth middleware', () => {
    it('should sign and verify JWT', () => {
      const user = { id: 'test-id', username: 'test-user', role: 'user' };
      const token = authMiddleware.signToken(user);
      assert.ok(token);
      assert.equal(token.split('.').length, 3);
    });

    it('requireAuth should pass valid token', () => {
      const user = { id: 'test-id', username: 'test-user', role: 'user' };
      const token = authMiddleware.signToken(user);
      const req = { headers: { authorization: `Bearer ${token}` } };
      let called = false;
      authMiddleware.requireAuth(req, {}, () => { called = true; });
      assert.equal(called, true);
      assert.equal(req.user.id, 'test-id');
    });

    it('requireAuth should reject missing header', () => {
      const req = { headers: {} };
      let status;
      const res = { status: (s) => { status = s; return { json: () => {} }; } };
      authMiddleware.requireAuth(req, res);
      assert.equal(status, 401);
    });

    it('requireAuth should reject expired token', () => {
      const expired = jwt.sign(
        { id: 'x', username: 'x', role: 'user' },
        'fc-auth-dev-secret-do-not-use-in-production',
        { expiresIn: '0s' }
      );
      const req = { headers: { authorization: `Bearer ${expired}` } };
      let status;
      const res = { status: (s) => { status = s; return { json: () => {} }; } };
      authMiddleware.requireAuth(req, res);
      assert.equal(status, 401);
    });

    it('requireAdmin should allow admin', () => {
      const req = { user: { role: 'admin' } };
      let called = false;
      authMiddleware.requireAdmin(req, {}, () => { called = true; });
      assert.equal(called, true);
    });

    it('requireAdmin should reject user role', () => {
      const req = { user: { role: 'user' } };
      let status;
      const res = { status: (s) => { status = s; return { json: () => {} }; } };
      authMiddleware.requireAdmin(req, res);
      assert.equal(status, 403);
    });
  });
});
