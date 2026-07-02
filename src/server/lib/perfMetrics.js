/**
 * Performance Metrics — 服务端性能指标收集
 *
 * 收集 API 响应时间、进程资源、数据库查询时间等指标。
 * 支持中间件自动计时和手动记录。
 */
class PerfMetrics {
  constructor() {
    this.apiLatencies = new Map(); // route → [latencies]
    this.queryLatencies = [];       // DB 查询时间
    this.samples = new Map();       // 自定义采样
    this.maxSamples = 1000;
  }

  /**
   * 创建 Express 中间件 — 自动记录 API 响应时间
   */
  middleware() {
    return (req, res, next) => {
      const start = Date.now();
      const route = `${req.method} ${req.path}`;

      res.on('finish', () => {
        const latency = Date.now() - start;
        this._recordLatency(route, latency);
      });

      next();
    };
  }

  /**
   * 记录数据库查询时间
   */
  recordQuery(latencyMs) {
    this.queryLatencies.push(latencyMs);
    if (this.queryLatencies.length > this.maxSamples) {
      this.queryLatencies.shift();
    }
  }

  /**
   * 自定义指标
   */
  record(name, value) {
    if (!this.samples.has(name)) {
      this.samples.set(name, []);
    }
    const arr = this.samples.get(name);
    arr.push(value);
    if (arr.length > this.maxSamples) {
      arr.shift();
    }
  }

  /**
   * 计算百分位
   */
  _percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  /**
   * 获取统计快照
   */
  snapshot() {
    const result = {
      api: {},
      db: { count: 0, p50: 0, p95: 0, p99: 0 },
      custom: {},
    };

    // API 延迟
    for (const [route, latencies] of this.apiLatencies) {
      const sorted = [...latencies].sort((a, b) => a - b);
      result.api[route] = {
        count: sorted.length,
        p50: this._percentile(sorted, 50),
        p95: this._percentile(sorted, 95),
        p99: this._percentile(sorted, 99),
        avg: sorted.reduce((s, v) => s + v, 0) / sorted.length,
      };
    }

    // DB 查询
    if (this.queryLatencies.length > 0) {
      const sorted = [...this.queryLatencies].sort((a, b) => a - b);
      result.db = {
        count: sorted.length,
        p50: this._percentile(sorted, 50),
        p95: this._percentile(sorted, 95),
        p99: this._percentile(sorted, 99),
      };
    }

    // 自定义指标
    for (const [name, values] of this.samples) {
      const sorted = [...values].sort((a, b) => a - b);
      result.custom[name] = {
        count: sorted.length,
        p50: this._percentile(sorted, 50),
        p95: this._percentile(sorted, 95),
        p99: this._percentile(sorted, 99),
      };
    }

    return result;
  }

  _recordLatency(route, latency) {
    if (!this.apiLatencies.has(route)) {
      this.apiLatencies.set(route, []);
    }
    const arr = this.apiLatencies.get(route);
    arr.push(latency);
    if (arr.length > this.maxSamples) {
      arr.shift();
    }
  }
}

export { PerfMetrics };
