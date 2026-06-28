import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname as pathDirname } from 'path';

/**
 * Creates a message store that persists conversation messages per session.
 *
 * Messages are stored as JSON arrays in `{workspaceDir}/{sessionId}/messages.json`.
 * Each message: { id, role: 'user'|'assistant'|'system', content, timestamp, files }
 *
 * @param {string} workspaceDir - Directory containing session subdirectories
 * @returns {{ loadMessages: Function, saveMessage: Function, appendToLastMessage: Function, deleteSessionMessages: Function }}
 */
export function createMessageStore(workspaceDir) {
  function filePathForSession(sessionId) {
    return join(workspaceDir, sessionId, 'messages.json');
  }

  /**
   * Load all messages for a session.
   * @param {string} sessionId
   * @returns {Promise<Array>}
   */
  async function loadMessages(sessionId) {
    try {
      const fp = filePathForSession(sessionId);
      if (!existsSync(fp)) return [];
      const raw = await readFile(fp, 'utf-8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.error('[MESSAGE] load failed for ' + sessionId + ': ' + e.message);
      return [];
    }
  }

  /**
   * Save a single message to the session's message file.
   * @param {string} sessionId
   * @param {object} msg - { role, content, files?, id? }
   * @returns {Promise<object>} the saved message with generated id and timestamp
   */
  async function saveMessage(sessionId, msg) {
    const messages = await loadMessages(sessionId);
    const saved = {
      id: msg.id || (Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      role: msg.role || 'user',
      content: msg.content || '',
      timestamp: Date.now(),
      files: msg.files || null
    };
    messages.push(saved);
    await writeMessages(sessionId, messages);
    return saved;
  }

  /**
   * Append text to the last assistant message in the session.
   * Used for streaming output accumulation.
   * @param {string} sessionId
   * @param {string} text
   */
  async function appendToLastMessage(sessionId, text) {
    const messages = await loadMessages(sessionId);
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'assistant') return;
    last.content += text;
    await writeMessages(sessionId, messages);
  }

  /**
   * Delete all messages for a session.
   * @param {string} sessionId
   */
  async function deleteSessionMessages(sessionId) {
    try {
      const fp = filePathForSession(sessionId);
      if (existsSync(fp)) await unlink(fp);
    } catch (e) {
      console.error('[MESSAGE] delete failed for ' + sessionId + ': ' + e.message);
    }
  }

  async function writeMessages(sessionId, messages) {
    try {
      const fp = filePathForSession(sessionId);
      const dir = pathDirname(fp);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      await writeFile(fp, JSON.stringify(messages), 'utf-8');
    } catch (e) {
      console.error('[MESSAGE] write failed for ' + sessionId + ': ' + e.message);
    }
  }

  return { loadMessages, saveMessage, appendToLastMessage, deleteSessionMessages };
}
