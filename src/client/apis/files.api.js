/**
 * Files API - handles file tree, read, write, delete operations
 */
import { api } from '$lib/api.js';

export async function getFileTree(sessionId, token) {
  return api.get(`/api/files/${sessionId}`, { token });
}

export async function readFile(sessionId, filePath, token) {
  return api.get(`/api/files/${sessionId}/${encodeURIComponent(filePath)}`, { token });
}

export async function writeFile(sessionId, filePath, content, token, csrfToken) {
  return api.post(`/api/files/${sessionId}/${encodeURIComponent(filePath)}`, { content }, { token, csrfToken });
}

export async function deleteFile(sessionId, filePath, token, csrfToken) {
  return api.delete(`/api/files/${sessionId}/${encodeURIComponent(filePath)}`, { token, csrfToken });
}
