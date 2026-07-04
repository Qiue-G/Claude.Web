/**
 * Token-bucket rate limiter, per-key.
 * Each key (IP, sessionId, etc.) gets a sliding 1-minute window.
 */
export function createRateLimiter(windowMs = 60000) {
  const limits = new Map();

  /**
   * Check if a key is within its rate limit.
   * Increments counter on each call.
   * @param {string} key
   * @param {number} max - max requests per window
   * @param {number} [windowMs] - optional override window
   * @returns {boolean} true if within limit
   */
  function check(key, max, windowMsOverride) {
    const win = windowMsOverride || windowMs;
    const now = Date.now();
    let entry = limits.get(key);
    if (!entry || now - entry.windowStart > win) {
      entry = { windowStart: now, count: 0 };
      limits.set(key, entry);
    }
    entry.count++;
    return entry.count <= max;
  }

  /**
   * Get remaining capacity for a key.
   * @param {string} key
   * @param {number} max
   * @param {number} [windowMsOverride]
   * @returns {number}
   */
  function remaining(key, max, windowMsOverride) {
    const win = windowMsOverride || windowMs;
    const now = Date.now();
    const entry = limits.get(key);
    if (!entry || now - entry.windowStart > win) return max;
    return Math.max(0, max - entry.count);
  }

  /**
   * Get a snapshot of current rate limit entries (for health/debugging).
   * @param {number} max - the default max for the endpoint (used to compute remaining)
   * @returns {Array<{key: string, count: number, remaining: number}>}
   */
  function snapshot(max) {
    const now = Date.now();
    const entries = [];
    for (const [key, entry] of limits) {
      entries.push({
        key,
        count: entry.count,
        remaining: now - entry.windowStart > windowMs ? max : Math.max(0, max - entry.count)
      });
    }
    return entries;
  }

  /**
   * Remove expired entries to prevent unbounded memory growth.
   */
  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of limits) {
      if (now - entry.windowStart > windowMs) {
        limits.delete(key);
      }
    }
  }

  // Auto-cleanup every 5 minutes
  const cleanupInterval = setInterval(cleanup, 5 * 60 * 1000);
  // Allow the process to exit even if the timer is still running
  if (typeof cleanupInterval.unref === 'function') {
    cleanupInterval.unref();
  }

  return { check, remaining, snapshot, cleanup };
}
