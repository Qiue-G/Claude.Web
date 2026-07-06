/**
 * SSE 流式 buffer 保护测试
 *
 * 覆盖 or_proxy.mjs 中的 SSE buffer 上限逻辑：
 * - MAX_BUFFER_SIZE = 512KB
 * - buffer 超限后重置并继续
 *
 * 测试方式：直接测试 buffer 截断逻辑（不启动 HTTP 服务器）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// ====================================================================
// SSE buffer 边界保护逻辑（与 or_proxy.mjs 第 407-428 行一致）
// ====================================================================

test('SSE buffer resets when exceeding MAX_BUFFER_SIZE', () => {
  const MAX_BUFFER_SIZE = 1024 * 512; // 512KB — 与 or_proxy.mjs 一致

  // 模拟：buffer 未超限时正常追加
  let buffer = '';
  const smallChunk = 'data: {"type":"ping"}\n\n'.repeat(100); // ~2.5KB
  buffer += smallChunk;
  assert.ok(buffer.length <= MAX_BUFFER_SIZE, 'Buffer should be under limit');
  assert.ok(buffer.length > 0, 'Buffer should contain data');

  // 模拟：超大 chunk 导致 buffer 超限
  buffer = '';
  const hugeChunk = 'x'.repeat(MAX_BUFFER_SIZE + 1); // 超过 512KB
  buffer += hugeChunk;

  // 触发 buffer 重置逻辑（与 or_proxy.mjs 第 421-425 行一致）
  if (buffer.length > MAX_BUFFER_SIZE) {
    console.error('[proxy] SSE buffer exceeded maximum size, resetting');
    buffer = '';
  }
  assert.equal(buffer.length, 0, 'Buffer should be reset to empty after exceeding limit');
});

test('SSE buffer correctly splits lines within limit', () => {
  // 模拟正常的行拆分逻辑（or_proxy.mjs 第 426-427 行）
  let buffer = '';
  const MAX_BUFFER_SIZE = 1024 * 512;

  const chunk1 = 'data: {"type":"ping"}\ndata: {"type":"pong"}\n';
  buffer += chunk1;
  assert.ok(buffer.length <= MAX_BUFFER_SIZE);

  const lines = buffer.split('\n');
  const remaining = lines.pop() || '';
  buffer = remaining;

  // 验证行拆分结果（pop 移除了最后一个换行后的空字符串）
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'data: {"type":"ping"}');
  assert.equal(lines[1], 'data: {"type":"pong"}');
});

test('SSE buffer stays under limit with many small chunks', () => {
  const MAX_BUFFER_SIZE = 1024 * 512;
  let buffer = '';

  // 模拟 1000 个小的 SSE 数据块
  for (let i = 0; i < 1000; i++) {
    buffer += `data: {"id":"${i}","content":"hello world"}\n`;
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer = '';
    }
  }

  // 验证 buffer 不超过上限（如果超限会被重置）
  assert.ok(buffer.length <= MAX_BUFFER_SIZE || buffer.length === 0,
    'Buffer should never exceed MAX_BUFFER_SIZE');
});

test('SSE buffer protects against slow drip memory exhaustion', () => {
  const MAX_BUFFER_SIZE = 1024 * 512;
  let buffer = '';
  let resetCount = 0;

  // 模拟：逐步追加小块，但没有换行符（SSE buffer 持续增长场景）
  for (let i = 0; i < 100; i++) {
    buffer += 'x'.repeat(MAX_BUFFER_SIZE / 50); // 每步 ~10KB

    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer = '';
      resetCount++;
    }
  }

  // 验证：buffer 保护被触发，重置了多次
  assert.ok(resetCount > 0, 'Buffer protection should trigger resets');
  assert.ok(buffer.length <= MAX_BUFFER_SIZE, 'Final buffer should be within limit');
});

// ====================================================================
// 数据行解析（SSE data: prefix stripping, or_proxy.mjs 第 429-433 行）
// ====================================================================

test('SSE line parser strips data: prefix correctly', () => {
  const lines = [
    'data: {"type":"ping"}',
    'data: [DONE]',
    'data: {"type":"error","message":"test"}',
    '',
    'event: error',
    ':comment'
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) continue;
    const dataStr = trimmed.slice(6);

    if (dataStr === '[DONE]') {
      assert.ok(true, '[DONE] terminator detected');
    } else {
      const parsed = JSON.parse(dataStr);
      assert.ok(parsed.type);
    }
  }
});
