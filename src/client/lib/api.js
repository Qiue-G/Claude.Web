/**
 * Unified API fetch wrapper.
 *
 * Features:
 *   - Always uses JSON body for POST/PUT/DELETE
 *   - Reads x-session-token and x-csrf-token from session.store
 *   - Throws structured errors with status code
 *   - Integrates with toast store if available
 *
 * Usage:
 *   import { api } from '$lib/api.js';
 *   const data = await api.get('/api/files/' + sessionId, { token });
 *   const result = await api.post('/api/session', { apiKey, model, provider });
 */

const BASE = '';

class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body && body.code;
    this.body = body;
  }
}

/**
 * Show a toast notification for the error if toast store is available.
 * @param {ApiError} err
 */
function showErrorToast(err) {
  try {
    // Lazy-import to avoid circular deps at module evaluation time
    import('../stores/toast.store.js').then(({ error: toastError }) => {
      const friendlyMessages = {
        400: '请求参数有误',
        401: '登录已过期，请刷新页面',
        403: '没有权限执行此操作',
        404: '请求的资源不存在',
        413: '文件过大（最大 500KB）',
        429: '请求过于频繁，请稍后再试',
        500: '服务器内部错误',
        503: '服务暂不可用'
      };
      toastError(err.code
        ? (err.body && err.body.retryAfter ? `请求过于频繁，请 ${err.body.retryAfter} 秒后重试` : err.message)
        : (friendlyMessages[err.status] || err.message)
      );
    }).catch(() => {
      // toast store not loaded, silently ignore
    });
  } catch (_) {
    // Ignore toast errors
  }
}

async function request(method, path, options = {}) {
  const { body, token, csrfToken, noToast, headers: extraHeaders } = options;

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-session-token'] = token;
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  if (extraHeaders) Object.assign(headers, extraHeaders);

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    let responseBody;
    try { responseBody = await res.json(); } catch { responseBody = { error: `HTTP ${res.status}` }; }
    const err = new ApiError(res.status, responseBody);
    if (!noToast) showErrorToast(err);
    throw err;
  }

  // HEAD/204 have no body
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  put: (path, body, options) => request('PUT', path, { ...options, body }),
  delete: (path, options) => request('DELETE', path, options)
};

export { ApiError };
