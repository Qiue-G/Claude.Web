/**
 * Files API - handles file tree, read, write, delete, version management
 */
import { api } from '$lib/api.js';

export async function getFileTree(sessionId, token) {
  return api.get(`/api/files/${sessionId}`, { token });
}

/**
 * List a single directory (non-recursive). Used for lazy loading in FileTree.
 * @param {string} sessionId
 * @param {string} dirPath - directory path relative to session root ('' for root)
 * @param {string} token
 */
export async function listDirectory(sessionId, dirPath, token) {
  const params = dirPath ? `?dir=${encodeURIComponent(dirPath)}` : '';
  return api.get(`/api/files/${sessionId}/list${params}`, { token });
}

export async function readFile(sessionId, filePath, token) {
  return api.get(`/api/files/${sessionId}/${encodeURIComponent(filePath)}`, { token });
}

export async function writeFile(sessionId, filePath, content, token, csrfToken) {
  return api.post(`/api/files/${sessionId}/${encodeURIComponent(filePath)}`, { content }, { token, csrfToken });
}

export async function deleteFileApi(sessionId, filePath, token, csrfToken) {
  return api.delete(`/api/files/${sessionId}/${encodeURIComponent(filePath)}`, { token, csrfToken });
}

export async function renameFile(sessionId, oldPath, newPath, token, csrfToken) {
  return api.put(`/api/files/${sessionId}/rename`, { oldPath, newPath }, { token, csrfToken });
}

// Alias for backwards compatibility
export const deleteFile = deleteFileApi;

// ===== Version Management API =====

/**
 * Get all versions for a file
 */
export async function getFileVersions(sessionId, filePath, token) {
  return api.get(`/api/files/${sessionId}/versions/${encodeURIComponent(filePath)}`, { token });
}

/**
 * Read a specific version's content
 */
export async function getVersionContent(sessionId, versionId, token) {
  return api.get(`/api/files/${sessionId}/version/${versionId}/_`, { token });
}

/**
 * Get diff between two versions
 */
export async function getDiff(sessionId, fromId, toId, token) {
  return api.get(`/api/files/${sessionId}/diff/${fromId}/${toId}`, { token });
}

/**
 * Rollback a file to a specific version
 */
export async function rollbackFile(sessionId, versionId, filePath, token, csrfToken) {
  return api.post(`/api/files/${sessionId}/rollback/${versionId}/${encodeURIComponent(filePath)}`, {}, { token, csrfToken });
}
