/**
 * Session API - handles session creation, retrieval, and deletion
 */
import { api } from '$lib/api.js';

export async function createSession(apiKey, model, provider) {
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
