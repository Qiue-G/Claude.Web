import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signToken, requireAuth, requireAdmin } from '../src/server/auth/authMiddleware.js';

describe('authMiddleware.js', () => {
  const testUser = { id: 'user-123', username: 'testuser', role: 'user' };
  const adminUser = { id: 'admin-456', username: 'admin', role: 'admin' };
  let userToken;
  let adminToken;
  let expiredToken;

  before(() => {
    userToken = signToken(testUser);
    adminToken = signToken(adminUser);
    // 用短过期时间造一个过期 token
    expiredToken = jwt.sign(
      { id: 'expired', username: 'expired', role: 'user' },
      'fc-auth-dev-secret-do-not-use-in-production',
      { expiresIn: '0s' }
    );
  });

  it('signToken should produce a valid JWT', () => {
    assert.ok(userToken);
    assert.equal(typeof userToken, 'string');
    // JWT has 3 dot-separated parts
    assert.equal(userToken.split('.').length, 3);
  });

  it('requireAuth should call next() for valid token', () => {
    const req = { headers: { authorization: `Bearer ${userToken}` } };
    let calledNext = false;
    requireAuth(req, {}, () => { calledNext = true; });
    assert.equal(calledNext, true);
    assert.equal(req.user.id, 'user-123');
    assert.equal(req.user.username, 'testuser');
  });

  it('requireAuth should reject missing header', () => {
    const req = { headers: {} };
    let statusCode;
    let jsonData;
    const res = {
      status: (code) => { statusCode = code; return { json: (data) => { jsonData = data; } }; }
    };
    requireAuth(req, res);
    assert.equal(statusCode, 401);
    assert.equal(jsonData.code, 'auth_required');
  });

  it('requireAuth should reject invalid token', () => {
    const req = { headers: { authorization: 'Bearer invalid.jwt.token' } };
    let statusCode;
    let jsonData;
    const res = {
      status: (code) => { statusCode = code; return { json: (data) => { jsonData = data; } }; }
    };
    requireAuth(req, res);
    assert.equal(statusCode, 401);
    assert.equal(jsonData.code, 'token_invalid');
  });

  it('requireAuth should reject expired token', () => {
    const req = { headers: { authorization: `Bearer ${expiredToken}` } };
    let statusCode;
    let jsonData;
    const res = {
      status: (code) => { statusCode = code; return { json: (data) => { jsonData = data; } }; }
    };
    requireAuth(req, res);
    assert.equal(statusCode, 401);
    assert.equal(jsonData.code, 'token_expired');
  });

  it('requireAdmin should allow admin', () => {
    const req = { user: { role: 'admin' } };
    let calledNext = false;
    requireAdmin(req, {}, () => { calledNext = true; });
    assert.equal(calledNext, true);
  });

  it('requireAdmin should reject non-admin', () => {
    const req = { user: { role: 'user' } };
    let statusCode;
    let jsonData;
    const res = {
      status: (code) => { statusCode = code; return { json: (data) => { jsonData = data; } }; }
    };
    requireAdmin(req, res);
    assert.equal(statusCode, 403);
    assert.equal(jsonData.code, 'admin_required');
  });

  it('signToken should throw for invalid input', () => {
    assert.throws(() => signToken({}), /must have id and username/);
    assert.throws(() => signToken(null), /must have id and username/);
    assert.throws(() => signToken(undefined), /must have id and username/);
  });
});
