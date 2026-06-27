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
export function addMessage(role, content, meta) {
  const msg = {
    id: Date.now() + Math.random(),
    role,
    content,
    meta: meta || null,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  };

  const sessionId = get(currentSessionId);
  if (sessionId) {
    addMessageToSession(sessionId, msg);
  }

  return msg;
}

/**
 * 清空当前会话的消息
 */
export function clearMessages() {
  tokenStats.set({ input: 0, inputMax: 200000, output: 0, outputMax: 16000 });

  const sessionId = get(currentSessionId);
  if (sessionId) {
    sessions.update(s => s.map(session =>
      session.id === sessionId
        ? { ...session, messages: [], updatedAt: Date.now() }
        : session
    ));
  }
}

/**
 * 向最后一条 assistant 消息追加内容（流式响应）
 */
export function appendToLastAssistant(text) {
  const sessionId = get(currentSessionId);
  if (!sessionId) return;

  sessions.update(s => s.map(session => {
    if (session.id !== sessionId) return session;
    const sessionMsgs = session.messages || [];
    const last = sessionMsgs[sessionMsgs.length - 1];
    if (last && last.role === 'assistant') {
      const updated = { ...last, content: last.content + text };
      return {
        ...session,
        messages: [...sessionMsgs.slice(0, -1), updated],
        updatedAt: Date.now()
      };
    }
    return session;
  }));
}

/**
 * 更新指定消息
 */
export function updateMessage(messageId, updates) {
  const sessionId = get(currentSessionId);
  if (!sessionId) return;

  sessions.update(s => s.map(session => {
    if (session.id !== sessionId) return session;
    const sessionMsgs = session.messages || [];
    return {
      ...session,
      messages: sessionMsgs.map(m => m.id === messageId ? { ...m, ...updates } : m),
      updatedAt: Date.now()
    };
  }));
}

/**
 * 删除指定消息
 */
export function deleteMessage(messageId) {
  const sessionId = get(currentSessionId);
  if (!sessionId) return;

  sessions.update(s => s.map(session => {
    if (session.id !== sessionId) return session;
    return {
      ...session,
      messages: (session.messages || []).filter(m => m.id !== messageId),
      updatedAt: Date.now()
    };
  }));
}
