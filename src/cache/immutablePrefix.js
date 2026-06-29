import { createHash } from 'node:crypto';
import { LruCache } from './lru.js';

/**
 * 不可变前缀缓存（ImmutablePrefix Cache）
 *
 * 对确定性系统指令/工具指令做增量哈希缓存，避免每次请求
 * 都重复渲染昂贵的 MCP 工具描述（可能含有大量 JSON Schema）。
 *
 * 缓存键：根据 tool IDs 的排序列表生成 SHA-256 摘要。
 */

// 全局 LRU — 最多缓存 32 种工具组合
const prefixCache = new LruCache({ maxSize: 32, ttl: 0 });

/**
 * 从工具 ID 列表生成缓存键
 */
function makeKey(toolIds) {
  const sorted = [...toolIds].sort().join('|');
  return createHash('sha256').update(sorted).digest('hex').substring(0, 16);
}

/**
 * 获取或构建系统指令前缀
 *
 * @param {string[]} toolIds - 已批准的工具 ID 列表
 * @param {() => string} buildFn - 如果未命中，调用此函数构造指令文本
 * @returns {string} 指令文本
 */
export function getOrBuildPrefix(toolIds, buildFn) {
  const key = makeKey(toolIds);
  let cached = prefixCache.get(key);
  if (cached !== undefined) return cached;

  const rendered = buildFn();
  prefixCache.set(key, rendered);
  return rendered;
}

/**
 * 清空前缀缓存（工具列表变更时调用，但实际很少需要）
 */
export function clearPrefixCache() {
  prefixCache.clear();
}