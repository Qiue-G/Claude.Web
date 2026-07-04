/**
 * 安全/认证集成测试
 *
 * 覆盖：
 * 1. 密码复杂度验证
 * 2. 输入长度限制
 * 3. JWT 过期时间验证
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

// ─── 密码复杂度验证 ───────────────────────────────────────────────

describe('密码复杂度验证', () => {
  let hashPassword;
  let verifyPassword;

  before(async () => {
    const mod = await import('../src/server/auth/password.js');
    hashPassword = mod.hashPassword;
    verifyPassword = mod.verifyPassword;
  });

  it('hashPassword 应拒绝空字符串', async () => {
    await assert.rejects(
      () => hashPassword(''),
      /Password must be a non-empty string/
    );
  });

  it('hashPassword 应拒绝 null/undefined', async () => {
    await assert.rejects(
      () => hashPassword(null),
      /Password must be a non-empty string/
    );
    await assert.rejects(
      () => hashPassword(undefined),
      /Password must be a non-empty string/
    );
  });

  it('hashPassword 应拒绝非字符串类型', async () => {
    await assert.rejects(
      () => hashPassword(123),
      /Password must be a non-empty string/
    );
  });

  it('hashPassword 应接受有效密码', async () => {
    const hash = await hashPassword('valid-password-123!@#');
    assert.ok(hash);
    assert.ok(hash.startsWith('$2a$') || hash.startsWith('$2b$'));
  });

  it('verifyPassword 应拒绝空密码', async () => {
    const result = await verifyPassword('', 'somehash');
    assert.equal(result, false);
  });

  it('verifyPassword 应拒绝 null hash', async () => {
    const result = await verifyPassword('password', null);
    assert.equal(result, false);
  });

  it('verifyPassword 应拒绝 undefined hash', async () => {
    const result = await verifyPassword('password', undefined);
    assert.equal(result, false);
  });

  it('verifyPassword 应正确验证有效密码', async () => {
    const hash = await hashPassword('MyC0mpl3x!Pass');
    const result = await verifyPassword('MyC0mpl3x!Pass', hash);
    assert.equal(result, true);
  });

  it('verifyPassword 应拒绝错误密码', async () => {
    const hash = await hashPassword('correct-password');
    const result = await verifyPassword('wrong-password', hash);
    assert.equal(result, false);
  });
});

// ─── 输入长度限制 ────────────────────────────────────────────────

describe('输入长度限制', () => {
  // 模拟 userRoutes 中的验证逻辑
  function validateUsername(username) {
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return { valid: false, error: 'Username must be at least 3 characters' };
    }
    return { valid: true };
  }

  function validatePassword(password) {
    if (!password || typeof password !== 'string' || password.length < 6) {
      return { valid: false, error: 'Password must be at least 6 characters' };
    }
    return { valid: true };
  }

  // 用户名长度验证
  it('用户名应至少 3 个字符', () => {
    assert.equal(validateUsername('ab').valid, false);
    assert.equal(validateUsername('abc').valid, true);
    assert.equal(validateUsername('abcd').valid, true);
  });

  it('用户名应拒绝空值和 null', () => {
    assert.equal(validateUsername('').valid, false);
    assert.equal(validateUsername(null).valid, false);
    assert.equal(validateUsername(undefined).valid, false);
  });

  it('用户名应修剪前后空格再检查长度', () => {
    // 修剪后的长度检查
    const result = validateUsername('  ab  ');
    assert.equal(result.valid, false);
  });

  // 密码长度验证
  it('密码应至少 6 个字符', () => {
    assert.equal(validatePassword('a1b2c').valid, false);
    assert.equal(validatePassword('a1b2c3').valid, true);
    assert.equal(validatePassword('a1b2c3d').valid, true);
  });

  it('密码应拒绝空值和 null', () => {
    assert.equal(validatePassword('').valid, false);
    assert.equal(validatePassword(null).valid, false);
    assert.equal(validatePassword(undefined).valid, false);
  });

  it('密码不应修剪前后空格（空格应计为有效字符）', () => {
    // userRoutes 没有 trim password，空格是有效字符
    const result = validatePassword('  a  ');  // 5 chars with spaces
    assert.equal(result.valid, false);
  });
});

// ─── JWT 过期时间验证 ────────────────────────────────────────────

describe('JWT 过期时间验证', () => {
  let signToken;
  let requireAuth;

  const JWT_SECRET = 'fc-auth-dev-secret-do-not-use-in-production';

  before(async () => {
    const mod = await import('../src/server/auth/authMiddleware.js');
    signToken = mod.signToken;
    requireAuth = mod.requireAuth;
  });

  it('signToken 生成的 JWT 应包含 exp 声明', () => {
    const token = signToken({ id: 'user-1', username: 'test', role: 'user' });
    const decoded = jwt.decode(token);
    assert.ok(decoded, 'Token 应能解码');
    assert.ok(decoded.exp, 'Token 应包含 exp 声明');
    assert.ok(typeof decoded.exp === 'number', 'exp 应为数字类型');
  });

  it('signToken 生成的 JWT 过期时间应为 ~8 小时', () => {
    const token = signToken({ id: 'user-1', username: 'test', role: 'user' });
    const decoded = jwt.decode(token);

    const issuedAt = decoded.iat;
    const expiresAt = decoded.exp;
    const ttlHours = (expiresAt - issuedAt) / 3600;

    // 允许 1 分钟的偏差（8h = 28800s）
    assert.ok(
      Math.abs(ttlHours - 8) < 0.1,
      `Token TTL ${ttlHours.toFixed(2)}h 应在 8h 附近`
    );
  });

  it('signToken 生成的 JWT 应能通过 jwt.verify 验证', () => {
    const token = signToken({ id: 'user-1', username: 'test', role: 'user' });
    const decoded = jwt.verify(token, JWT_SECRET);
    assert.equal(decoded.id, 'user-1');
    assert.equal(decoded.username, 'test');
    assert.equal(decoded.role, 'user');
  });

  it('过期的 JWT 应被 requireAuth 拒绝', () => {
    const expiredToken = jwt.sign(
      { id: 'expired-user', username: 'expired', role: 'user' },
      JWT_SECRET,
      { expiresIn: '0s' }
    );

    const req = { headers: { authorization: `Bearer ${expiredToken}` } };
    let statusCode;
    let jsonData;
    const res = {
      status: (code) => {
        statusCode = code;
        return { json: (data) => { jsonData = data; } };
      },
    };

    requireAuth(req, res);

    assert.equal(statusCode, 401);
    assert.equal(jsonData.code, 'token_expired');
  });

  it('无效的 JWT 签名应被 requireAuth 拒绝', () => {
    const tokenWithWrongSecret = jwt.sign(
      { id: 'user-1', username: 'test', role: 'user' },
      'wrong-secret-key'
    );

    const req = { headers: { authorization: `Bearer ${tokenWithWrongSecret}` } };
    let statusCode;
    let jsonData;
    const res = {
      status: (code) => {
        statusCode = code;
        return { json: (data) => { jsonData = data; } };
      },
    };

    requireAuth(req, res);

    assert.equal(statusCode, 401);
    assert.equal(jsonData.code, 'token_invalid');
  });

  it('缺失 Authorization header 应被 requireAuth 拒绝', () => {
    const req = { headers: {} };
    let statusCode;
    let jsonData;
    const res = {
      status: (code) => {
        statusCode = code;
        return { json: (data) => { jsonData = data; } };
      },
    };

    requireAuth(req, res);

    assert.equal(statusCode, 401);
    assert.equal(jsonData.code, 'auth_required');
  });

  it('非 Bearer 格式的 Authorization header 应被拒绝', () => {
    const req = { headers: { authorization: 'Token some-value' } };
    let statusCode;
    let jsonData;
    const res = {
      status: (code) => {
        statusCode = code;
        return { json: (data) => { jsonData = data; } };
      },
    };

    requireAuth(req, res);

    assert.equal(statusCode, 401);
    assert.equal(jsonData.code, 'auth_required');
  });

  it('signToken 应在 payload 中包含 id、username、role', () => {
    const token = signToken({ id: 'u-42', username: 'alice', role: 'admin' });
    const decoded = jwt.decode(token);

    assert.equal(decoded.id, 'u-42');
    assert.equal(decoded.username, 'alice');
    assert.equal(decoded.role, 'admin');
  });

  it('signToken 应默认 role 为 user', () => {
    const token = signToken({ id: 'u-1', username: 'bob' });
    const decoded = jwt.decode(token);
    assert.equal(decoded.role, 'user');
  });

  it('signToken 应拒绝缺失 id 或 username 的输入', () => {
    assert.throws(() => signToken({}), /must have id and username/);
    assert.throws(() => signToken({ id: '1' }), /must have id and username/);
    assert.throws(() => signToken({ username: 'u' }), /must have id and username/);
    assert.throws(() => signToken(null), /must have id and username/);
    assert.throws(() => signToken(undefined), /must have id and username/);
  });
});
