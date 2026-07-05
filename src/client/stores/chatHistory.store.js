/**
 * Chat History Store - manages chat sessions and history
 * 使用 IndexedDB 进行持久化存储，支持 localStorage 作为后备
 */
import { writable, derived, get } from 'svelte/store';
import * as db from '$lib/indexedDB.js';

const STORAGE_KEY = 'chatSessions';
const MAX_SESSIONS = 50;
const SAVE_DEBOUNCE_MS = 300;

// 检查是否支持 IndexedDB
const useIndexedDB = typeof indexedDB !== 'undefined';

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSessions(sessions) {
  try {
    const trimmed = sessions.length > MAX_SESSIONS ? sessions.slice(0, MAX_SESSIONS) : sessions;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {}
}

// 异步加载会话数据
async function loadSessionsAsync() {
  if (!useIndexedDB) {
    return loadSessions();
  }

  try {
    await db.initDB();
    const loadedSessions = await db.getAll(db.STORES.CHAT_SESSIONS);
    return loadedSessions || [];
  } catch (error) {
    console.error('Failed to load from IndexedDB, falling back to localStorage:', error);
    return loadSessions();
  }
}

// 异步保存会话数据
async function saveSessionsAsync(sessions) {
  if (!useIndexedDB) {
    saveSessions(sessions);
    return;
  }

  try {
    await db.initDB();
    const trimmed = sessions.length > MAX_SESSIONS ? sessions.slice(0, MAX_SESSIONS) : sessions;
    await db.putAll(db.STORES.CHAT_SESSIONS, trimmed);
  } catch (error) {
    console.error('Failed to save to IndexedDB, falling back to localStorage:', error);
    saveSessions(sessions);
  }
}

// 修复订阅泄漏：使用 debounced 持久化，不创建永久订阅
export const sessions = writable([]);

// 同步保存到 localStorage（立即，用于快速响应）
function schedulePersist(value) {
  // 仅写入 localStorage（同步），IndexedDB 写入由 syncSessions 处理
  saveSessions(value);
}

// 防抖的 IndexedDB 同步
let saveTimer = null;
function debouncedAsyncSave(value) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveSessionsAsync(value);
    saveTimer = null;
  }, SAVE_DEBOUNCE_MS);
}

// 修复：使用显式订阅，在模块卸载时自动清理
// 注意：Svelte stores 在模块作用域中的订阅会持续到应用关闭
// 这里使用一个标志位避免重复订阅
let initialized = false;
function initPersistence() {
  if (initialized) return;
  initialized = true;
  sessions.subscribe((value) => {
    schedulePersist(value);
    debouncedAsyncSave(value);
  });
}

export const currentSessionId = writable(null);

export const currentSession = derived(
  [sessions, currentSessionId],
  ([$sessions, $currentSessionId]) => $sessions.find(s => s.id === $currentSessionId) || null
);

export function createSession(title = '新对话') {
  const id = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const session = {
    id,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };

  sessions.update(s => [session, ...s]);
  currentSessionId.set(id);
  return session;
}

export function switchSession(sessionId) {
  currentSessionId.set(sessionId);
}

export function updateSessionTitle(sessionId, title) {
  sessions.update(s => s.map(session =>
    session.id === sessionId ? { ...session, title, updatedAt: Date.now() } : session
  ));
}

export function addMessageToSession(sessionId, message) {
  sessions.update(s => s.map(session =>
    session.id === sessionId
      ? { ...session, messages: [...session.messages, message], updatedAt: Date.now() }
      : session
  ));
}

export function deleteSession(sessionId) {
  sessions.update(s => s.filter(session => session.id !== sessionId));
  currentSessionId.update(id => id === sessionId ? null : id);
}

export function clearAllSessions() {
  sessions.set([]);
  currentSessionId.set(null);
}

// 异步初始化（单一入口）
export async function initChatHistory() {
  const loadedSessions = await loadSessionsAsync();
  
  if (loadedSessions.length > 0) {
    // IndexedDB 有数据，直接使用
    sessions.set(loadedSessions);
    // 不自动选中会话，让用户自己选择或发送消息时自动创建
  } else {
    // IndexedDB 为空，尝试从 localStorage 恢复
    const localData = loadSessions();
    if (localData.length > 0) {
      sessions.set(localData);
      // 异步同步到 IndexedDB
      syncSessions();
    } else {
      // 完全没有数据，不创建默认会话，等用户发送消息时自动创建
    }
  }
  
  initPersistence();
}

// 修复：使用 get() 替代 subscribe，消除订阅泄漏
export function syncSessions() {
  const currentSessions = get(sessions);
  saveSessionsAsync(currentSessions);
  // 同步写入 localStorage 作为即时备份
  saveSessions(currentSessions);
}

// 注意：不在模块加载时同步设置 sessions 数据
// 所有初始化都通过 initChatHistory() 统一入口完成
// 这样可以避免 IndexedDB 和 localStorage 的竞态条件
// initPersistence 由 initChatHistory() 统一调用，避免重复订阅
