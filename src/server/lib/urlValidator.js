/**
 * URL 验证器
 *
 * SSRF 防护：阻止内网/私有地址请求。
 * 用作全局中间件或提取器前置校验。
 */
import { URL } from 'url';

// 私有 IPv4 段
const PRIVATE_RANGES = [
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '0.0.0.0', end: '0.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' }, // link-local
];

// 保留/特殊用途 IPv4 段
const RESERVED_RANGES = [
  { start: '240.0.0.0', end: '255.255.255.255' }, // 组播/保留
  { start: '100.64.0.0', end: '100.127.255.255' }, // CGNAT
  { start: '198.18.0.0', end: '198.19.255.255' },  // 基准测试
];

// 内网 hostname (不区分大小写)
const INTERNAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '::1',
  'localhost.localdomain',
]);

function ip4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isInRange(ipInt, range) {
  const start = ip4ToInt(range.start);
  const end = ip4ToInt(range.end);
  if (start === null || end === null) return false;
  return ipInt >= start && ipInt <= end;
}

/**
 * 验证 URL 是否安全可访问
 * @param {string} urlStr
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // 1. 协议检查
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Protocol "${parsed.protocol}" is not allowed. Only http/https supported` };
  }

  // 2. Hostname 黑名单
  const hostname = parsed.hostname.toLowerCase();

  if (INTERNAL_HOSTNAMES.has(hostname)) {
    return { valid: false, error: `Internal hostname "${hostname}" is not allowed` };
  }

  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { valid: false, error: `Internal domain "${hostname}" is not allowed` };
  }

  // 3. IP 地址范围检查
  // 先尝试解析 IPv4 字面量
  const isIpv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);

  if (isIpv4) {
    const ipInt = ip4ToInt(hostname);
    if (ipInt === null) {
      return { valid: false, error: 'Invalid IP address format' };
    }

    for (const range of PRIVATE_RANGES) {
      if (isInRange(ipInt, range)) {
        return { valid: false, error: `Private IP range (${range.start}-${range.end}) is not allowed` };
      }
    }

    for (const range of RESERVED_RANGES) {
      if (isInRange(ipInt, range)) {
        return { valid: false, error: `Reserved IP range (${range.start}-${range.end}) is not allowed` };
      }
    }
  }

  // 4. IPv6 环回检查
  if (hostname.startsWith('[::') || hostname === '::1') {
    return { valid: false, error: 'IPv6 loopback is not allowed' };
  }

  // 5. 最大长度
  if (urlStr.length > 4096) {
    return { valid: false, error: 'URL too long (max 4096 characters)' };
  }

  return { valid: true };
}

/**
 * Express 中间件：验证请求体中的 URL 字段
 * 默认检查 req.body.url 字段
 * @param {object} [options]
 * @param {string} [options.field='url'] - 要验证的字段名
 */
export function urlValidationMiddleware(options = {}) {
  const field = options.field || 'url';
  return (req, res, next) => {
    const urlStr = req.body?.[field];
    if (urlStr) {
      const result = validateUrl(urlStr);
      if (!result.valid) {
        return res.status(400).json({ error: result.error, code: 'invalid_url' });
      }
    }
    next();
  };
}