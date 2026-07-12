/**
 * Chat Store - manages chat messages and state
 * 统一通过 chatHistory.store 的 sessions 存储消息
 */
import { writable, derived, get } from 'svelte/store';
import {
  currentSession,
  currentSessionId,
  sessions,
  addMessageToSession
} from './chatHistory.store.js';

export const MAX_STORED_MESSAGES = 100;

/**
 * 辅助函数：按 sessionId 更新会话，自动设置 updatedAt
 */
function updateSession(sessionId, updater) {
  sessions.update(s => s.map(session =>
    session.id === sessionId
      ? { ...updater(session), updatedAt: Date.now() }
      : session
  ));
}

// messages 现在是从 currentSession 派生的派生 store
// 避免双份存储和同步问题
export const messages = derived(currentSession, ($session) => {
  return $session?.messages || [];
});

export const isWaiting = writable(false);
export const isTyping = writable(false);

export const tokenStats = writable({
  input: 0,
  inputMax: 200000,
  output: 0,
  outputMax: 16000
});

/**
 * 添加一条消息到当前会话
 */
export function addMessage(role, content, meta, files) {
  const msg = {
    id: Date.now() + Math.random(),
    role,
    content,
    meta: meta || null,
    files: files || null,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  };

  const sessionId = get(currentSessionId);
  if (sessionId) {
    addMessageToSession(sessionId, msg);
  }

  return msg;
}

/**
 * 替换当前会话的全部消息（用于从服务器加载历史消息）
 */
export function setMessages(msgs) {
  const sessionId = get(currentSessionId);
  if (!sessionId) return;
  updateSession(sessionId, session => ({ ...session, messages: msgs || [] }));
}

/**
 * 在消息列表前面插入旧消息（用于分页加载更早的历史）
 * @param {Array} olderMessages - 更早的消息数组
 */
export function prependMessages(olderMessages) {
  const sessionId = get(currentSessionId);
  if (!sessionId || !olderMessages?.length) return;
  updateSession(sessionId, session => {
    const existingIds = new Set(session.messages.map(m => m.id));
    const uniqueOlder = olderMessages.filter(m => !existingIds.has(m.id));
    return { ...session, messages: [...uniqueOlder, ...session.messages] };
  });
}

/**
 * 清空当前会话的消息
 */
export function clearMessages() {
  tokenStats.set({ input: 0, inputMax: 200000, output: 0, outputMax: 16000 });

  const sessionId = get(currentSessionId);
  if (sessionId) {
    updateSession(sessionId, session => ({ ...session, messages: [] }));
  }
}

/**
 * 查找最近的 assistant 消息索引（跳过中间的 system 消息）
 */
function findLastAssistantIndex(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') return i;
    if (msgs[i].role === 'user') return -1;
  }
  return -1;
}

/**
 * 向最近的 assistant 消息追加内容（流式响应）
 * 会跳过中间插入的 system 消息（如 file_diff）
 */
export function appendToLastAssistant(text) {
  const sessionId = get(currentSessionId);
  if (!sessionId) return;
  updateSession(sessionId, session => {
    const sessionMsgs = session.messages || [];
    const idx = findLastAssistantIndex(sessionMsgs);
    if (idx >= 0) {
      const msg = sessionMsgs[idx];
      const updated = { ...msg, content: msg.content + text };
      return { ...session, messages: [...sessionMsgs.slice(0, idx), updated, ...sessionMsgs.slice(idx + 1)] };
    }
    return session;
  });
}

/**
 * 更新指定消息
 */
export function updateMessage(messageId, updates) {
  const sessionId = get(currentSessionId);
  if (!sessionId) return;
  updateSession(sessionId, session => ({
    ...session,
    messages: (session.messages || []).map(m => m.id === messageId ? { ...m, ...updates } : m),
  }));
}

/**
 * 删除指定消息
 */
export function deleteMessage(messageId) {
  const sessionId = get(currentSessionId);
  if (!sessionId) return;
  updateSession(sessionId, session => ({
    ...session,
    messages: (session.messages || []).filter(m => m.id !== messageId),
  }));
}

/**
 * 向最近的 assistant 消息追加一个工具调用（内嵌在消息中，不创建独立消息）
 * 会跳过中间插入的 system 消息（如 file_diff）
 * @returns {string} 生成的工具调用 ID，用于后续状态更新
 */
export function appendToolCallToLastAssistant(toolCall) {
  let generatedId = '';
  const sessionId = get(currentSessionId);
  if (!sessionId) return generatedId;
  updateSession(sessionId, session => {
    const sessionMsgs = session.messages || [];
    const idx = findLastAssistantIndex(sessionMsgs);
    if (idx >= 0) {
      const msg = sessionMsgs[idx];
      const toolCalls = msg.toolCalls || [];
      const newTc = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        toolName: toolCall.toolName,
        toolInput: toolCall.toolInput,
        status: 'running',
        result: '',
        error: ''
      };
      generatedId = newTc.id;
      const updated = {
        ...msg,
        toolCalls: [...toolCalls, newTc]
      };
      return { ...session, messages: [...sessionMsgs.slice(0, idx), updated, ...sessionMsgs.slice(idx + 1)] };
    }
    return session;
  });
  return generatedId;
}

/**
 * 更新最近 assistant 消息中第一个 running 状态的工具调用
 * （按顺序匹配，避免同名工具调用冲突）
 */
export function updateLastRunningToolCall(status, result, error) {
  const sessionId = get(currentSessionId);
  if (!sessionId) return;
  updateSession(sessionId, session => {
    const sessionMsgs = session.messages || [];
    const idx = findLastAssistantIndex(sessionMsgs);
    if (idx >= 0) {
      const msg = sessionMsgs[idx];
      if (msg.toolCalls?.length) {
        let updated = false;
        const toolCalls = msg.toolCalls.map(tc => {
          if (!updated && tc.status === 'running') {
            updated = true;
            return { ...tc, status, result: result || '', error: error || '' };
          }
          return tc;
        });
        if (updated) {
          const msgUpdated = { ...msg, toolCalls };
          return { ...session, messages: [...sessionMsgs.slice(0, idx), msgUpdated, ...sessionMsgs.slice(idx + 1)] };
        }
      }
    }
    return session;
  });
}

/**
 * 删除指定消息之后的所有消息（用于编辑/重试）
 */
export function deleteMessagesAfter(messageId) {
  const sessionId = get(currentSessionId);
  if (!sessionId) return;
  updateSession(sessionId, session => {
    const msgs = session.messages || [];
    const idx = msgs.findIndex(m => m.id === messageId);
    if (idx === -1) return session;
    return { ...session, messages: msgs.slice(0, idx + 1) };
  });
}
