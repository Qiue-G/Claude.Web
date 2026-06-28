/**
 * Per-model stream health statistics.
 * Tracks success/fail counts and timestamps for each model ID.
 */
export function createModelStats() {
  const stats = new Map(); // modelId → { total, success, fail, lastOk, lastFail, lastError }

  function recordSuccess(modelId) {
    let s = stats.get(modelId);
    if (!s) stats.set(modelId, (s = { total: 0, success: 0, fail: 0, lastOk: null, lastFail: null, lastError: null }));
    s.total++;
    s.success++;
    s.lastOk = Date.now();
  }

  function recordFail(modelId, errorDetail) {
    let s = stats.get(modelId);
    if (!s) stats.set(modelId, (s = { total: 0, success: 0, fail: 0, lastOk: null, lastFail: null, lastError: null }));
    s.total++;
    s.fail++;
    s.lastFail = Date.now();
    s.lastError = errorDetail;
  }

  function getAll() {
    const result = [];
    for (const [id, s] of stats) {
      const total = s.total || 0;
      const rate = total > 0 ? ((s.success / total) * 100).toFixed(1) : '0.0';
      result.push({
        id,
        total,
        success: s.success,
        fail: s.fail,
        successRate: parseFloat(rate),
        lastOk: s.lastOk,
        lastFail: s.lastFail,
        lastError: s.lastError
      });
    }
    result.sort((a, b) => b.total - a.total);
    return result;
  }

  return { map: stats, recordSuccess, recordFail, getAll };
}
