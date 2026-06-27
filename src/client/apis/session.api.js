/**
 * Session API - handles session creation, retrieval, and deletion
 */

const BASE = '';

/**
 * Create a new session
 */
export async function createSession(apiKey, model, provider) {
  const res = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, model, provider })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Get session info
 */
export async function getSession(sessionId, token) {
  const res = await fetch(`${BASE}/api/session/${sessionId}`, {
    headers: { 'x-session-token': token || '' }
  });
  if (!res.ok) throw new Error('Invalid session');
  return res.json();
}

/**
 * Delete session
 */
export async function deleteSession(sessionId, token, csrfToken) {
  const res = await fetch(`${BASE}/api/session/${sessionId}`, {
    method: 'DELETE',
    headers: {
      'x-session-token': token || '',
      'x-csrf-token': csrfToken || ''
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
