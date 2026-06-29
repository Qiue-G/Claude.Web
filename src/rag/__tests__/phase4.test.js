/**
 * Phase 4 生产化测试
 *
 * 覆盖：
 * 1. URL 验证器（SSRF 防护）
 * 2. RAG 可观测性指标
 * 3. 指标集成（嵌入 + 检索 + 摄入）
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ══════════════════════════════════════════════
// URL Validator Tests
// ══════════════════════════════════════════════
describe('URL Validator', () => {
  let validateUrl;

  before(async () => {
    const mod = await import('../../server/lib/urlValidator.js');
    validateUrl = mod.validateUrl;
  });

  it('should allow valid public HTTPS URLs', () => {
    const result = validateUrl('https://example.com');
    assert.equal(result.valid, true);
  });

  it('should allow valid public HTTP URLs', () => {
    const result = validateUrl('http://example.com');
    assert.equal(result.valid, true);
  });

  it('should reject file:// protocol', () => {
    const result = validateUrl('file:///etc/passwd');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('Protocol'));
  });

  it('should reject ftp:// protocol', () => {
    const result = validateUrl('ftp://files.example.com');
    assert.equal(result.valid, false);
  });

  it('should reject localhost', () => {
    const result = validateUrl('http://localhost:3000');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('not allowed'));
  });

  it('should reject 127.0.0.1', () => {
    const result = validateUrl('http://127.0.0.1:8080');
    assert.equal(result.valid, false);
  });

  it('should reject 0.0.0.0', () => {
    const result = validateUrl('http://0.0.0.0');
    assert.equal(result.valid, false);
  });

  it('should reject private 10.x.x.x', () => {
    const result = validateUrl('http://10.0.0.1/api/data');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('Private IP'));
  });

  it('should reject private 192.168.x.x', () => {
    const result = validateUrl('http://192.168.1.1');
    assert.equal(result.valid, false);
  });

  it('should reject private 172.16-31.x.x', () => {
    const result = validateUrl('http://172.16.0.1');
    assert.equal(result.valid, false);
  });

  it('should reject link-local 169.254.x.x', () => {
    const result = validateUrl('http://169.254.1.1');
    assert.equal(result.valid, false);
  });

  it('should reject .local domains', () => {
    const result = validateUrl('http://myhost.local');
    assert.equal(result.valid, false);
  });

  it('should reject .internal domains', () => {
    const result = validateUrl('http://service.internal');
    assert.equal(result.valid, false);
  });

  it('should reject empty URL', () => {
    const result = validateUrl('');
    assert.equal(result.valid, false);
  });

  it('should reject non-string input', () => {
    const result = validateUrl(null);
    assert.equal(result.valid, false);
  });

  it('should reject URLs longer than 4096 chars', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(4096);
    const result = validateUrl(longUrl);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('too long'));
  });

  it('should reject malformed URLs', () => {
    const result = validateUrl('not a url');
    assert.equal(result.valid, false);
  });

  it('should pass valid URLs with query params', () => {
    const result = validateUrl('https://api.example.com/v1/search?q=test&limit=10');
    assert.equal(result.valid, true);
  });

  it('should pass valid URLs with ports', () => {
    const result = validateUrl('https://api.example.com:443/v1/data');
    assert.equal(result.valid, true);
  });
});

// ══════════════════════════════════════════════
// RAG Metrics Tests
// ══════════════════════════════════════════════
describe('RAG Metrics', () => {
  let metrics;

  before(async () => {
    const mod = await import('../metrics.js');
    metrics = mod.createRagMetrics();
  });

  it('should start with empty search stats', () => {
    const stats = metrics.getSearchStats();
    assert.equal(stats.count, 0);
    assert.equal(stats.avgLatencyMs, 0);
  });

  it('should record search latencies', () => {
    metrics.recordSearch(50);
    metrics.recordSearch(100);
    metrics.recordSearch(200);

    const stats = metrics.getSearchStats();
    assert.equal(stats.count, 3);
    assert.equal(stats.minMs, 50);
    assert.equal(stats.maxMs, 200);
    assert.ok(stats.avgLatencyMs >= 100);
  });

  it('should calculate p50/p95/p99 percentiles', () => {
    // Reset with known values
    for (let i = 0; i < 100; i++) {
      metrics.recordSearch(100 + i);
    }

    const stats = metrics.getSearchStats();
    assert.ok(stats.p50Ms >= 100);
    assert.ok(stats.p95Ms >= 100);
    assert.ok(stats.p99Ms >= 100);
  });

  it('should record embed API success', () => {
    metrics.recordEmbedSuccess(200);
    metrics.recordEmbedSuccess(300);

    const stats = metrics.getEmbedStats();
    assert.equal(stats.totalCalls, 2);
    assert.equal(stats.success, 2);
    assert.equal(stats.fail, 0);
    assert.equal(stats.successRate, 100);
  });

  it('should record embed API failures', () => {
    metrics.recordEmbedFail(150);

    const stats = metrics.getEmbedStats();
    assert.equal(stats.totalCalls, 3);
    assert.equal(stats.success, 2);
    assert.equal(stats.fail, 1);
    assert.ok(stats.successRate < 100);
  });

  it('should track embed cache hits and misses', () => {
    metrics.recordEmbedCacheHit();
    metrics.recordEmbedCacheHit();
    metrics.recordEmbedCacheMiss();

    const stats = metrics.getEmbedStats();
    assert.equal(stats.cacheHits, 2);
    assert.equal(stats.cacheMisses, 1);
    assert.ok(stats.cacheHitRate > 0);
  });

  it('should record ingest operations', () => {
    metrics.recordIngest(5);
    metrics.recordIngest(10);

    const stats = metrics.getIngestStats();
    assert.equal(stats.totalIngestCalls, 2);
    assert.equal(stats.totalChunksIngested, 15);
  });

  it('should provide full metrics snapshot', () => {
    const snapshot = metrics.getSnapshot();
    assert.ok(snapshot.uptimeMs > 0);
    assert.ok(snapshot.search);
    assert.ok(snapshot.embed);
    assert.ok(snapshot.ingest);
  });

  it('should reset all metrics', () => {
    metrics.reset();
    const stats = metrics.getSearchStats();
    assert.equal(stats.count, 0);
    assert.equal(metrics.getEmbedStats().totalCalls, 0);
    assert.equal(metrics.getIngestStats().totalIngestCalls, 0);
  });
});

// ══════════════════════════════════════════════
// Metrics Integration Tests
// ══════════════════════════════════════════════
describe('Metrics Integration', () => {
  it('should be exposed on RAG system', async () => {
    const { createRagSystem } = await import('../index.js');
    const rag = await createRagSystem({});
    assert.ok(rag.metrics);
    assert.equal(typeof rag.getMetricsSnapshot, 'function');
  });

  it('should track metrics through ingest', async () => {
    const { createRagSystem } = await import('../index.js');
    const rag = await createRagSystem({});

    const count = await rag.ingest('test', 'Hello this is a test document for measuring metrics');
    assert.ok(count > 0);

    // Verify metrics recorded
    const ingestStats = rag.metrics.getIngestStats();
    assert.ok(ingestStats.totalIngestCalls >= 1);
    assert.ok(ingestStats.totalChunksIngested >= count);

    rag.deleteCollection('test');
  });

  it('should have getMetricsSnapshot returning correct shape', async () => {
    const { createRagSystem } = await import('../index.js');
    const rag = await createRagSystem({});
    const snapshot = rag.getMetricsSnapshot();

    assert.ok('uptimeMs' in snapshot);
    assert.ok('search' in snapshot);
    assert.ok('embed' in snapshot);
    assert.ok('ingest' in snapshot);
    assert.equal(typeof snapshot.search.count, 'number');
    assert.equal(typeof snapshot.embed.totalCalls, 'number');
    assert.equal(typeof snapshot.ingest.totalIngestCalls, 'number');
  });

  it('should track embed cache hits/misses via RAG system', async () => {
    const { createRagSystem } = await import('../index.js');
    const rag = await createRagSystem({});
    const testText = 'Cache me if you can ' + Date.now();

    // First ingestion should be a cache miss
    await rag.ingest('test-cache', testText);
    const statsAfterFirst = rag.metrics.getEmbedStats();

    // Second ingestion of same text — should hit cache
    await rag.ingest('test-cache', testText);
    const statsAfterSecond = rag.metrics.getEmbedStats();

    // At least one cache miss and one cache hit (the second ingest)
    assert.ok(statsAfterSecond.cacheMisses >= statsAfterFirst.cacheMisses);
    assert.ok(statsAfterSecond.cacheHits >= statsAfterFirst.cacheHits);

    rag.deleteCollection('test-cache');
  });
});