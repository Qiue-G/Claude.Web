/**
 * CacheManager — 统一缓存管理器
 *
 * 提供 TTL 过期、LRU 淘汰、容量限制的统一缓存方案。
 * 用于替换项目中分散的 `new Map()` 缓存模式。
 *
 * @example
 * const cache = new CacheManager({ ttl: 60000, maxSize: 100 });
 * cache.set('key', value);
 * const v = cache.get('key'); // null if expired or evicted
 */
class CacheManager {
  /**
   * @param {Object} opts
   * @param {number} [opts.ttl=0]      - 默认 TTL（毫秒），0 表示不过期
   * @param {number} [opts.maxSize=500] - 最大缓存条目数
   */
  constructor(opts = {}) {
    this.ttl = opts.ttl || 0;
    this.maxSize = opts.maxSize || 500;
    /** @type {Map<string, { value: any, expiresAt: number, hits: number }>} */
    this._cache = new Map();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  /**
   * 设置缓存
   * @param {string} key
   * @param {any} value
   * @param {number} [ttl] - 可选，覆盖实例默认 TTL
   */
  set(key, value, ttl) {
    // 如果 key 已存在，先删除（保持 LRU 顺序）
    if (this._cache.has(key)) {
      this._cache.delete(key);
    }

    // 达到上限 → 淘汰最久未访问的（第一个 entry）
    if (this._cache.size >= this.maxSize) {
      const oldestKey = this._cache.keys().next().value;
      if (oldestKey !== undefined) {
        this._cache.delete(oldestKey);
        this._evictions++;
      }
    }

    const expiresAt = ttl !== undefined ? Date.now() + ttl
      : this.ttl > 0 ? Date.now() + this.ttl
      : 0;

    this._cache.set(key, { value, expiresAt, hits: 0 });
  }

  /**
   * 获取缓存
   * @param {string} key
   * @returns {any|null} 不存在或已过期返回 null
   */
  get(key) {
    const entry = this._cache.get(key);
    if (!entry) {
      this._misses++;
      return null;
    }

    // 检查过期
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this._cache.delete(key);
      this._misses++;
      return null;
    }

    // LRU: 删除后重新插入（移到末尾）
    this._cache.delete(key);
    this._cache.set(key, entry);
    entry.hits++;
    this._hits++;

    return entry.value;
  }

  /**
   * 检查 key 是否存在且未过期
   */
  has(key) {
    const entry = this._cache.get(key);
    if (!entry) return false;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this._cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 删除缓存
   */
  delete(key) {
    return this._cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear() {
    this._cache.clear();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  /**
   * 当前缓存条目数
   */
  get size() {
    return this._cache.size;
  }

  /**
   * 获取所有 key
   */
  keys() {
    return this._cache.keys();
  }

  /**
   * 遍历所有有效条目
   */
  forEach(fn) {
    const now = Date.now();
    for (const [key, entry] of this._cache) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        this._cache.delete(key);
        continue;
      }
      fn(entry.value, key);
    }
  }

  /**
   * 获取统计快照（用于监控）
   */
  snapshot() {
    // 清理过期条目
    const now = Date.now();
    for (const [key, entry] of this._cache) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        this._cache.delete(key);
      }
    }

    return {
      size: this._cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      hitRate: this._hits + this._misses > 0
        ? (this._hits / (this._hits + this._misses) * 100).toFixed(1) + '%'
        : '0%',
    };
  }

  /**
   * 创建一个包装函数缓存 —— 缓存异步函数的调用结果
   * @param {Function} fn        - 异步函数
   * @param {Object}   opts
   * @param {string}   [opts.prefix='']    - key 前缀
   * @param {number}   [opts.ttl]          - 缓存 TTL
   * @param {(args: any[]) => string} [opts.keyFn] - 自定义 key 生成
   * @returns {Function} 带缓存的包装函数
   */
  wrapAsync(fn, opts = {}) {
    const prefix = opts.prefix || '';
    const ttl = opts.ttl;
    const keyFn = opts.keyFn || ((args) => args.map(a => String(a)).join(':'));

    return async (...args) => {
      const key = prefix + ':' + keyFn(args);
      const cached = this.get(key);
      if (cached !== null) return cached;

      const result = await fn(...args);
      this.set(key, result, ttl);
      return result;
    };
  }
}

export { CacheManager };
