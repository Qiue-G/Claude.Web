import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, isEncrypted, ENC_PREFIX } from '../src/server/lib/crypto.js';

// 设置测试密钥（32字节 = 64十六进制字符）
const TEST_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

test('encrypt returns null for null/undefined input', () => {
  const orig = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;
  assert.equal(encrypt(null), null);
  assert.equal(encrypt(undefined), undefined);
  assert.equal(encrypt(''), '');
  process.env.ENCRYPTION_KEY = orig;
});

test('encrypt and decrypt roundtrip', () => {
  const orig = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;

  const apiKey = 'sk-ant-api03-test-key-12345';
  const encrypted = encrypt(apiKey);
  assert.ok(encrypted.startsWith(ENC_PREFIX), '加密结果应以 enc: 开头');
  assert.notEqual(encrypted, apiKey, '加密结果不应等于原文');

  const decrypted = decrypt(encrypted);
  assert.equal(decrypted, apiKey, '解密结果应等于原文');

  process.env.ENCRYPTION_KEY = orig;
});

test('isEncrypted detects encrypted values', () => {
  const orig = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;

  assert.equal(isEncrypted(null), false);
  assert.equal(isEncrypted(''), false);
  assert.equal(isEncrypted('sk-ant-test'), false);
  assert.equal(isEncrypted(ENC_PREFIX + 'abc'), true);

  const encrypted = encrypt('test-key');
  assert.equal(isEncrypted(encrypted), true);

  process.env.ENCRYPTION_KEY = orig;
});

test('encrypt is idempotent (double encrypt returns same)', () => {
  const orig = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;

  const apiKey = 'sk-ant-test-key';
  const first = encrypt(apiKey);
  const second = encrypt(first);
  assert.equal(first, second, '重复加密应返回相同结果');

  process.env.ENCRYPTION_KEY = orig;
});

test('decrypt returns plaintext for non-encrypted input', () => {
  const orig = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;

  const plain = 'sk-ant-plain-key';
  assert.equal(decrypt(plain), plain, '未加密的输入应直接返回');

  process.env.ENCRYPTION_KEY = orig;
});

test('encrypt/decrypt with missing ENCRYPTION_KEY returns plaintext', () => {
  const orig = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;

  const apiKey = 'sk-ant-test-key';
  const result = encrypt(apiKey);
  assert.equal(result, apiKey, '无密钥时应返回原文');

  process.env.ENCRYPTION_KEY = orig;
});

test('decrypt with wrong key returns original encrypted text', () => {
  const orig = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;

  const apiKey = 'sk-ant-test-key';
  const encrypted = encrypt(apiKey);

  // 切换密钥
  process.env.ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000';
  const result = decrypt(encrypted);
  // 解密失败应返回原文（密文）
  assert.equal(result, encrypted);

  process.env.ENCRYPTION_KEY = orig;
});

test('encrypt produces different ciphertext each time (random IV)', () => {
  const orig = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;

  const apiKey = 'sk-ant-test-key';
  const enc1 = encrypt(apiKey);
  const enc2 = encrypt(apiKey);
  assert.notEqual(enc1, enc2, '相同明文应产生不同密文（随机 IV）');

  // 但都能正确解密
  assert.equal(decrypt(enc1), apiKey);
  assert.equal(decrypt(enc2), apiKey);

  process.env.ENCRYPTION_KEY = orig;
});

test('encrypt handles various API key formats', () => {
  const orig = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;

  const keys = [
    'sk-ant-api03-abc123',
    'gsk_abc123def456',
    'xai-abc-123-xyz',
    'Bearer token123',
    'a'.repeat(200),  // 长密钥
  ];

  for (const key of keys) {
    const encrypted = encrypt(key);
    assert.ok(encrypted.startsWith(ENC_PREFIX), `${key.substring(0, 10)}... 加密结果应以 enc: 开头`);
    assert.equal(decrypt(encrypted), key, `${key.substring(0, 10)}... 应能正确解密`);
  }

  process.env.ENCRYPTION_KEY = orig;
});
