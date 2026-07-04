/**
 * Session API - handles session creation, retrieval, and deletion
 */
import { api } from '$lib/api.js';

export async function createSession(apiKey, model, provider) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('API key is required');
  }
  return api.post('/api/session', { apiKey, model, provider });
}

export async function getSession(sessionId, token) {
  return api.get(`/api/session/${sessionId}`, { token });
}

export async function validateSession(sessionId, token) {
  return api.get('/api/session/current', {
    noToast: true,
    headers: {
      'x-session-id': sessionId || '',
      'x-session-token': token || ''
    }
  });
}

export async function deleteSession(sessionId, token, csrfToken) {
  return api.delete(`/api/session/${sessionId}`, { token, csrfToken });
}

/**
 * 生成会话分享链接
 * @param {string} sessionId
 * @param {string} authToken - JWT token for authentication
 * @returns {Promise<{ shareToken: string, shareUrl: string, status: string }>}
 */
export async function shareSession(sessionId, authToken) {
  return api.post(`/api/session/${sessionId}/share`, null, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
}

/**
 * 取消会话分享
 * @param {string} sessionId
 * @param {string} authToken - JWT token
 * @returns {Promise<{ success: boolean, status: string }>}
 */
export async function unshareSession(sessionId, authToken) {
  return api.delete(`/api/session/${sessionId}/share`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
}

/**
 * 添加协作者
 * @param {string} sessionId
 * @param {string} username
 * @param {string} authToken - JWT token
 * @returns {Promise<{ success: boolean, collaborators: Array }>}
 */
export async function addCollaborator(sessionId, username, authToken) {
  return api.post(`/api/session/${sessionId}/collaborators`, { username }, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
}

/**
 * 移除协作者
 * @param {string} sessionId
 * @param {string} username
 * @param {string} authToken - JWT token
 * @returns {Promise<{ success: boolean, collaborators: Array }>}
 */
export async function removeCollaborator(sessionId, username, authToken) {
  return api.delete(`/api/session/${sessionId}/collaborators/${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
}

/**
 * 获取协作者列表
 * @param {string} sessionId
 * @param {string} authToken - JWT token
 * @returns {Promise<{ collaborators: Array }>}
 */
export async function getCollaborators(sessionId, authToken) {
  return api.get(`/api/session/${sessionId}/collaborators`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
}

/**
 * 通过分享 Token 加入会话
 * @param {string} token - share token
 * @param {string} authToken - JWT token
 * @returns {Promise<{ success: boolean, sessionId: string }>}
 */
export async function joinSessionByToken(token, authToken) {
  return api.post(`/api/session/join/${token}`, null, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
}

// ===== 版本历史 API (T5) =====

/**
 * 获取某条消息的版本列表
 * @param {string} sessionId
 * @param {string} messageId
 * @param {string} token - JWT token
 * @returns {Promise<{ sessionId: string, messageId: string, versions: Array }>}
 */
export async function getMessageVersions(sessionId, messageId, token) {
  return api.get(`/api/session/${sessionId}/versions/${messageId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

/**
 * 回滚到指定版本
 * @param {string} sessionId
 * @param {string} messageId
 * @param {number} version
 * @param {string} token - JWT token
 * @returns {Promise<{ success: boolean, message: string, version: object }>}
 */
export async function restoreVersion(sessionId, messageId, version, token) {
  return api.post(`/api/session/${sessionId}/versions/${messageId}/restore/${version}`, null, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

/**
 * 获取两个版本的差异
 * @param {string} sessionId
 * @param {string} messageId
 * @param {number} v1
 * @param {number} v2
 * @param {string} token - JWT token
 * @returns {Promise<{ sessionId: string, messageId: string, v1: number, v2: number, diff: Array }>}
 */
export async function getVersionDiff(sessionId, messageId, v1, v2, token) {
  return api.get(`/api/session/${sessionId}/versions/${messageId}/diff?v1=${v1}&v2=${v2}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}
