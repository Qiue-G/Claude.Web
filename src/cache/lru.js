/**
 * LRU 缓存（最近最少使用）
 *
 * O(1) get/set，自动淘汰最久未访问的条目。
 * 可选 TTL 支持。
 */
export class LruCache {
  /**
   * @param {object} options
   * @param {number} [options.maxSize=100] - 最大条目数
   * @param {number} [options.ttl=0] - 过期毫秒数（0 = 永不过期）
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize ?? 100;
    this.ttl = options.ttl ?? 0;
    /** @type {Map<string, { value: any, expires: number }>} */
    this._map = new Map();
  }

  /**
   * 获取值。访问后该条目变为最近使用。
   * @param {string} key
   * @returns {any|undefined}
   */
  get(key) {
    const entry = this._map.get(key);
    if (entry === undefined) return undefined;

    // 检查 TTL
    if (this.ttl > 0 && Date.now() > entry.expires) {
      this._map.delete(key);
      return undefined;
    }

    // 移到末尾（最近使用）
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }

  /**
   * 设置值
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    // 如果已存在，先删除以更新顺序
    if (this._map.has(key)) {
      this._map.delete(key);
    }

    // 淘汰最旧条目
    while (this._map.size >= this.maxSize) {
      const oldest = this._map.keys().next();
      if (oldest.done) break;
      this._map.delete(oldest.value);
    }

    this._map.set(key, {
      value,
      expires: this.ttl > 0 ? Date.now() + this.ttl : Infinity,
    });
  }

  /**
   * 检查是否存在（不更新访问顺序）
   */
  has(key) {
    if (!this._map.has(key)) return false;
    if (this.ttl > 0 && Date.now() > this._map.get(key).expires) {
      this._map.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 删除单个条目
   */
  delete(key) {
    this._map.delete(key);
  }

  /**
   * 清空所有
   */
  clear() {
    this._map.clear();
  }

  /**
   * 当前条目数
   */
  get size() {
    return this._map.size;
  }
}