/**
 * WebSocket Manager - handles real-time communication with server
 *
 * Features:
 * - Exponential backoff reconnection (1s → 30s, max 5 attempts)
 * - Message queue: buffers messages during disconnection, replays on reconnect
 * - Network status listener: pauses reconnect when offline, resumes on online
 * - Ping/pong heartbeat: detects dead connections every 30s
 */
import { isConnected, connectionStatus, sessionId, sessionToken, csrfToken } from '$stores/session.store.js';
import { messages, addMessage, appendToLastAssistant, appendToolCallToLastAssistant, updateLastRunningToolCall, isWaiting, isTyping, setMessages, prependMessages } from '$stores/chat.store.js';
import { filtersConfig } from '$stores/filters.store.js';
import { stripAnsi } from '$lib/utils.js';
import { t } from '$lib/i18n.js';
import { get } from 'svelte/store';
import { warning } from '$stores/toast.store.js';

let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let reconnectResetTimer = null;
const MAX_RECONNECT_DELAY = 60000;
const MAX_RECONNECT_ATTEMPTS = 20;
let autoReconnectEnabled = true;
let isOffline = false;

// 协作客户端就绪回调（App.svelte 用于初始化 CollabClient）
let _onReadyCallback = null;
let _readyCalled = false;

// 历史消息分页状态（替代 window.__history* 全局变量）
let _historyPage = 0;
let _historyTotalPages = 1;
let _historyHasMore = false;

export function onWsReady(callback) {
  _onReadyCallback = callback;
  // 如果 ready 消息已经到达过，立即调用
  if (_readyCalled) callback();
}

export function getWs() {
  return ws;
}

// ── Message Queue: buffer messages during disconnection ──
const pendingMessages = [];
const MAX_PENDING = 50;
const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1MB 背压阈值

function queueMessage(payload) {
  if (pendingMessages.length >= MAX_PENDING) {
    pendingMessages.shift(); // Drop oldest
  }
  pendingMessages.push(payload);
}

function flushPendingMessages() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  while (pendingMessages.length > 0) {
    const msg = pendingMessages.shift();
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
      pendingMessages.unshift(msg); // Put back on failure
      break;
    }
  }
}

// ─ Ping/Pong Heartbeat ──
let heartbeatTimer = null;
const HEARTBEAT_INTERVAL = 30000;

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch (_) { /* ignore */ }
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─ Network Status Listener ──
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    isOffline = true;
    connectionStatus.set('disconnected');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  });

  window.addEventListener('online', () => {
    isOffline = false;
    const sid = get(sessionId);
    const token = get(sessionToken);
    if (sid && token && autoReconnectEnabled) {
      reconnectAttempts = 0;
      connectWebSocket(sid, token, autoReconnectEnabled);
    }
  });
}

// C1: BroadcastChannel for cross-tab session sync
let sessionChannel = null;
if (typeof BroadcastChannel !== 'undefined') {
  sessionChannel = new BroadcastChannel('claude-free-session');
  sessionChannel.onmessage = (event) => {
    if (event.data?.type === 'session_expired') {
      warning(get(t)('session.expired'));
      sessionId.set(null);
      sessionToken.set(null);
      localStorage.removeItem('sessionId');
      localStorage.removeItem('sessionToken');
      autoReconnectEnabled = false;
      if (ws) { ws.onclose = null; ws.close(); ws = null; }
    }
  };
}

export function connectWebSocket(sid, token, autoReconnect = true) {
  autoReconnectEnabled = autoReconnect;
  if (ws) {
    ws.onclose = null;
    ws.close();
  }

  connectionStatus.set('connecting');

  // 不在 URL 中传输 token（防止日志/代理/浏览器历史泄露）
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'init', sessionId: sid, token: token }));
    startHeartbeat();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (e) {
      // Non-JSON message (raw terminal output)
      const text = stripAnsi(event.data);
      if (text.trim()) {
        appendToLastAssistant(text);
      }
    }
  };

  ws.onclose = () => {
    isConnected.set(false);
    connectionStatus.set('disconnected');
    isTyping.set(false);
    stopHeartbeat();

    // WebSocket 断开后持续重连（指数退避，最长 60s，最多 MAX_RECONNECT_ATTEMPTS 次）
    if (isOffline || !autoReconnectEnabled) return;

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      connectionStatus.set('disconnected');
      warning(get(t)('connection.maxReconnect'));
      return;
    }

    const currentSid = get(sessionId);
    const currentToken = get(sessionToken);
    if (!currentSid || !currentToken) return;

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    connectionStatus.set('reconnecting');
    reconnectTimer = setTimeout(() => {
      connectWebSocket(currentSid, currentToken, autoReconnectEnabled);
    }, delay);

    // 每 5 分钟重置一次重连指数退避，避免延迟过长
    if (reconnectResetTimer) clearTimeout(reconnectResetTimer);
    reconnectResetTimer = setTimeout(() => {
      reconnectAttempts = Math.max(0, reconnectAttempts - 2);
    }, 300000);
  };

  ws.onerror = () => {
    connectionStatus.set('error');
  };
}

// 等待 WebSocket 就绪（轮询检测）
function waitForWsOpen(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const interval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
    setTimeout(() => {
      clearInterval(interval);
      reject(new Error('WebSocket not ready'));
    }, timeoutMs);
  });
}

export async function sendInput(data) {
  const payload = typeof data === 'string'
    ? { type: 'input', data: { text: data } }
    : { type: 'input', data };

  // 先尝试现有 WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    // 背压控制：缓冲区超过阈值时排队，延迟重试
    if (ws.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      queueMessage(payload);
      setTimeout(() => { flushPendingMessages(); }, 200);
      return;
    }
    try {
      ws.send(JSON.stringify(payload));
      return;
    } catch (e) {
      console.error('sendInput: ws.send failed', e);
    }
  }

  // 断线时入队，等待重连后补发
  if (ws && ws.readyState !== WebSocket.OPEN) {
    queueMessage(payload);
    const sid = get(sessionId);
    const token = get(sessionToken);
    if (sid && token && !isOffline) {
      connectWebSocket(sid, token, true);
    }
    return;
  }

  // WebSocket 不存在，尝试恢复连接并等待就绪
  const sid = get(sessionId);
  const token = get(sessionToken);
  if (sid && token) {
    queueMessage(payload);
    connectWebSocket(sid, token, true);
    try {
      await waitForWsOpen(5000);
      if (ws && ws.readyState === WebSocket.OPEN) {
        flushPendingMessages();
        return;
      }
    } catch (_) {
      // 等待超时
    }
  }

  // 会话过期或丢失：尝试从 localStorage 恢复已保存的会话
  const savedSid = localStorage.getItem('sessionId');
  const savedToken = localStorage.getItem('sessionToken');
  if (savedSid && savedToken && savedSid !== sid) {
    sessionId.set(savedSid);
    sessionToken.set(savedToken);
    queueMessage(payload);
    connectWebSocket(savedSid, savedToken, true);
    try {
      await waitForWsOpen(8000);
      if (ws && ws.readyState === WebSocket.OPEN) {
        flushPendingMessages();
        return;
      }
    } catch (_) {}
  }

  // 所有方式都失败，重置等待状态
  isWaiting.set(false);
  isTyping.set(false);
  addMessage('system', get(t)('chat.sendFailed'));
}

export function disconnectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (reconnectResetTimer) {
    clearTimeout(reconnectResetTimer);
    reconnectResetTimer = null;
  }
  stopHeartbeat();
  autoReconnectEnabled = false; // 阻止自动重连

  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }

  isConnected.set(false);
  connectionStatus.set('disconnected');
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'ready':
      isConnected.set(true);
      connectionStatus.set('connected');
      reconnectAttempts = 0;
      flushPendingMessages();
      // 连接就绪时，将当前过滤器配置同步到后端
      {
        const cfg = get(filtersConfig);
        if (cfg && Object.keys(cfg).length > 0) {
          ws.send(JSON.stringify({ type: 'update_filters', config: cfg }));
        }
      }
      _readyCalled = true;
      _onReadyCallback?.();
      if (get(isWaiting)) {
        isWaiting.set(false);
        isTyping.set(false);
        addMessage('system', get(t)('status.reconnected'));
      }
      break;
    case 'pong':
      // Heartbeat response — connection alive
      break;
    case 'history':
      if (Array.isArray(msg.messages) && msg.messages.length > 0) {
        setMessages(msg.messages);
        // 如果还有更多历史，保存分页信息
        if (msg.hasMore) {
          _historyPage = msg.page || 0;
          _historyTotalPages = msg.totalPages || 1;
          _historyHasMore = msg.hasMore;
        }
      } else {
        setMessages([]);
      }
      break;
    case 'history_page':
      if (Array.isArray(msg.messages) && msg.messages.length > 0) {
        prependMessages(msg.messages);
        _historyPage = msg.page;
        _historyHasMore = msg.hasMore;
      }
      break;
    case 'output':
      {
        const msgs = get(messages);
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== 'assistant') {
          addMessage('assistant', '');
        }
      }
      appendToLastAssistant(stripAnsi(msg.data || ''));
      break;
    case 'tool_use':
      {
        // 将工具调用内嵌到最后一条 assistant 消息中（不创建新消息）
        const msgs = get(messages);
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== 'assistant') {
          addMessage('assistant', '');
        }
        appendToolCallToLastAssistant({
          toolName: msg.toolName,
          toolInput: msg.toolInput
        });
      }
      break;
    case 'tool_result':
      {
        updateLastRunningToolCall('success', msg.result, '');
      }
      break;
    case 'tool_error':
      {
        updateLastRunningToolCall('error', '', msg.error);
      }
      break;
    case 'stderr':
      appendToLastAssistant(stripAnsi('[stderr] ' + (msg.data || '')));
      break;
    case 'done':
    case 'exit':
      isWaiting.set(false);
      isTyping.set(false);
      window.dispatchEvent(new CustomEvent('files-changed'));
      break;
    case 'file_diff':
      if (Array.isArray(msg.diffs)) {
        for (const diff of msg.diffs) {
          addMessage('system', '', { type: 'file_diff', ...diff });
        }
      }
      window.dispatchEvent(new CustomEvent('files-changed'));
      break;
    case 'error':
      isWaiting.set(false);
      isTyping.set(false);
      if (msg.message && msg.message.includes('Invalid session')) {
        sessionId.set(null);
        sessionToken.set(null);
        autoReconnectEnabled = false;
      }
      addMessage('system', msg.message || get(t)('common.error'));
      break;
    case 'model_update':
      break;
    case 'tool_approval_request':
      window.dispatchEvent(new CustomEvent('tool-approval-request', {
        detail: {
          approvalId: msg.approvalId,
          tools: msg.tools
        }
      }));
      break;
    case 'tool_approval_complete':
      window.dispatchEvent(new CustomEvent('tool-approval-complete'));
      break;
    case 'session_expired':
      // C1: Session expired — notify user and clear session
      warning(get(t)('session.expired'));
      sessionId.set(null);
      sessionToken.set(null);
      autoReconnectEnabled = false;
      // 同步清理 localStorage，防止 sendInput 尝试恢复过期会话
      localStorage.removeItem('sessionId');
      localStorage.removeItem('sessionToken');
      // 复用模块级 sessionChannel 通知其他 tab
      if (sessionChannel) {
        sessionChannel.postMessage({ type: 'session_expired' });
      }
      break;

    // ===== Parallel model comparison messages =====
    case 'parallel_started':
      window.dispatchEvent(new CustomEvent('parallel-started', { detail: msg }));
      break;
    case 'parallel_chunk':
      window.dispatchEvent(new CustomEvent('parallel-chunk', { detail: msg }));
      break;
    case 'parallel_model_done':
      window.dispatchEvent(new CustomEvent('parallel-model-done', { detail: msg }));
      break;
    case 'parallel_all_done':
      window.dispatchEvent(new CustomEvent('parallel-all-done', { detail: msg }));
      break;
    case 'parallel_error':
      window.dispatchEvent(new CustomEvent('parallel-error', { detail: msg }));
      break;

    default:
      break;
  }
}

/**
 * 发送工具审批结果到服务端
 * @param {string} approvalId
 * @param {string[]} approved - 批准的 tool id 数组，空数组表示全部拒绝
 */
export function sendToolApproval(approvalId, approved) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'tool_approval_response',
      approvalId,
      approved
    }));
  }
}

/**
 * 发送并行模型调用请求
 * @param {string} prompt - 要发送的提示
 * @param {string[]} modelIds - 要对比的模型 ID 列表
 */
export function sendParallel(prompt, modelIds) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'parallel_start',
      prompt,
      modelIds
    }));
  }
}

/**
 * 发送 Bash 命令执行请求（来自 AI 代码块的允许执行按钮）
 * @param {string} command - 要执行的 shell 命令
 */
export function sendBashCommand(command) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'run_bash_command',
      command
    }));
  }
}

/**
 * 请求加载更早的历史消息
 */
export function loadMoreHistory() {
  const page = _historyPage + 1;
  if (ws && ws.readyState === WebSocket.OPEN && _historyHasMore) {
    ws.send(JSON.stringify({
      type: 'load_more',
      page
    }));
  }
}

/**
 * Check if there are more historical messages to load.
 */
export function hasMoreHistory() {
  return _historyHasMore;
}
