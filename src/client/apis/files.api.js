/**
 * Files API - handles file tree, read, write, delete operations
 */
import { encodeFilePath } from '$lib/utils.js';

const BASE = '';

/**
 * Get file tree for a session
 */
export async function getFileTree(sessionId, token) {
  const res = await fetch(`${BASE}/api/files/${sessionId}`, {
    headers: { 'x-session-token': token || '' }
  });
  if (!res.ok) throw new Error('Failed to load file tree');
  return res.json();
}

/**
 * Read file content
 */
export async function readFile(sessionId, filePath, token) {
  const res = await fetch(`${BASE}/api/files/${sessionId}/${encodeFilePath(filePath)}`, {
    headers: { 'x-session-token': token || '' }
  });
  if (!res.ok) throw new Error('Failed to read file');
  return res.json();
}

/**
 * Write file content
 */
export async function writeFile(sessionId, filePath, content, token, csrfToken) {
  const res = await fetch(`${BASE}/api/files/${sessionId}/${encodeFilePath(filePath)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': token || '',
      'x-csrf-token': csrfToken || ''
    },
    body: JSON.stringify({ content })
  });
  if (!res.ok) throw new Error('Failed to write file');
  return res.json();
}

/**
 * Delete file
 */
export async function deleteFile(sessionId, filePath, token, csrfToken) {
  const res = await fetch(`${BASE}/api/files/${sessionId}/${encodeFilePath(filePath)}`, {
    method: 'DELETE',
    headers: {
      'x-session-token': token || '',
      'x-csrf-token': csrfToken || ''
    }
  });
  if (!res.ok) throw new Error('Failed to delete file');
  return res.json();
}
