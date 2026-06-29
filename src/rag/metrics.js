/**
 * RAG 系统可观测性指标收集器
 *
 * 追踪关键指标：
 * - 检索延迟（per-query timing）
 * - 嵌入 API 延迟 + 成功率
 * - 嵌入缓存命中率
 * - 摄入统计
 * - 集合级统计
 */
export function createRagMetrics() {
  // ── 检索延迟 ──
  const searchLatencies = []; // 滑动窗口：最近 N 次检索耗时 (ms)
  const SEARCH_WINDOW = 1000;

  // ── 嵌入 API ──
  let embedTotal = 0;
  let embedSuccess = 0;
  let embedFail = 0;
  let embedTotalLatency = 0; // 累计毫秒
  const embedLatencies = [];

  // ── 嵌入缓存 ──
  let embedCacheHits = 0;
  let embedCacheMisses = 0;

  // ── 摄入 ──
  let ingestCount = 0;
  let ingestChunkCount = 0;

  // ── 启动时间 ──
  const startTime = Date.now();

  return {
    // ══════ 检索指标 ══════
    recordSearch(latencyMs) {
      searchLatencies.push(latencyMs);
      if (searchLatencies.length > SEARCH_WINDOW) {
        searchLatencies.shift();
      }
    },

    getSearchStats() {
      if (searchLatencies.length === 0) {
        return { count: 0, avgLatencyMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, minMs: 0, maxMs: 0 };
      }
      const sorted = [...searchLatencies].sort((a, b) => a - b);
      const len = sorted.length;
      const sum = sorted.reduce((a, b) => a + b, 0);
      return {
        count: len,
        avgLatencyMs: Math.round(sum / len),
        p50Ms: sorted[Math.floor(len * 0.5)],
        p95Ms: sorted[Math.floor(len * 0.95)],
        p99Ms: sorted[Math.floor(len * 0.99)],
        minMs: sorted[0],
        maxMs: sorted[len - 1],
      };
    },

    // ══════ 嵌入 API 指标 ══════
    recordEmbedSuccess(latencyMs) {
      embedTotal++;
      embedSuccess++;
      embedTotalLatency += latencyMs;
      embedLatencies.push(latencyMs);
    },

    recordEmbedFail(latencyMs) {
      embedTotal++;
      embedFail++;
      embedTotalLatency += latencyMs;
      embedLatencies.push(latencyMs);
    },

    recordEmbedCacheHit() {
      embedCacheHits++;
    },

    recordEmbedCacheMiss() {
      embedCacheMisses++;
    },

    getEmbedStats() {
      const total = embedTotal;
      const successRate = total > 0 ? Math.round((embedSuccess / total) * 1000) / 10 : 0;
      const avgLatency = embedTotal > 0 ? Math.round(embedTotalLatency / embedTotal) : 0;
      const cacheTotal = embedCacheHits + embedCacheMisses;
      const cacheHitRate = cacheTotal > 0 ? Math.round((embedCacheHits / cacheTotal) * 1000) / 10 : 0;
      return {
        totalCalls: total,
        success: embedSuccess,
        fail: embedFail,
        successRate,
        avgLatencyMs: avgLatency,
        cacheHits: embedCacheHits,
        cacheMisses: embedCacheMisses,
        cacheHitRate,
      };
    },

    // ══════ 摄入指标 ══════
    recordIngest(chunks) {
      ingestCount++;
      ingestChunkCount += chunks;
    },

    getIngestStats() {
      return {
        totalIngestCalls: ingestCount,
        totalChunksIngested: ingestChunkCount,
      };
    },

    // ══════ 全量快照 ══════
    getSnapshot() {
      return {
        uptimeMs: Date.now() - startTime,
        search: this.getSearchStats(),
        embed: this.getEmbedStats(),
        ingest: this.getIngestStats(),
      };
    },

    reset() {
      searchLatencies.length = 0;
      embedTotal = 0;
      embedSuccess = 0;
      embedFail = 0;
      embedTotalLatency = 0;
      embedLatencies.length = 0;
      embedCacheHits = 0;
      embedCacheMisses = 0;
      ingestCount = 0;
      ingestChunkCount = 0;
    },
  };
}