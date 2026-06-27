/**
 * WebSocket Manager - handles real-time communication with server
 * Supports both WebSocket and SSE for streaming responses
 */
import { isConnected, connectionStatus, sessionId, sessionToken, csrfToken } from '$stores/session.store.js';
import { addMessage, appendToLastAssistant, isWaiting, isTyping } from '$stores/chat.store.js';
import { stripAnsi } from '$lib/utils.js';
import { get } from 'svelte/store';

let ws = null;
let eventSource = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
let autoReconnectEnabled = true;
let useSSEMode = false;

// Buffer for SSE streaming
let sseBuffer = '';
let sseFlushTimer = null;
const SSE_FLUSH_INTERVAL = 50; // ms

export function connectWebSocket(sid, token, autoReconnect = true, useSSE = false) {
  autoReconnectEnabled = autoReconnect;
  useSSEMode = useSSE;
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  if (eventSource) {
    eventSource.close();
  }

  connectionStatus.set('connecting');

  if (useSSE) {
    connectSSE(sid, token, autoReconnect);
  } else {
    connectWebSocketProtocol(sid, token, autoReconnect);
  }
}

function connectWebSocketProtocol(sid, token, autoReconnect) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    // 发送 init 消息，服务端需要 sessionId 和 token 来验证会话
    ws.send(JSON.stringify({ type: 'init', sessionId: sid, token: token }));
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
    isWaiting.set(false);
    isTyping.set(false);

    // Auto reconnect using current session values from store
    if (autoReconnectEnabled && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const currentSid = get(sessionId);
      const currentToken = get(sessionToken);
      if (!currentSid || !currentToken) return;

      const delay = RECONNECT_DELAYS[reconnectAttempts] || RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1];
      reconnectAttempts++;
      connectionStatus.set('reconnecting');
      addMessage('system', `连接断开，${delay / 1000}秒后尝试重连 (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      reconnectTimer = setTimeout(() => {
        connectWebSocket(currentSid, currentToken, autoReconnectEnabled, useSSEMode);
      }, delay);
    }
  };

  ws.onerror = () => {
    connectionStatus.set('error');
  };
}

function connectSSE(sid, token, autoReconnect) {
  const url = `/sse`;
  eventSource = new EventSource(url);

  eventSource.onopen = () => {
    isConnected.set(true);
    connectionStatus.set('connected');
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  eventSource.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (e) {
      // Raw text message
      const text = stripAnsi(event.data);
      if (text.trim()) {
        bufferSSEContent(text);
      }
    }
  };

  eventSource.onerror = () => {
    isConnected.set(false);
    connectionStatus.set('error');
    isWaiting.set(false);
    isTyping.set(false);

    if (autoReconnectEnabled && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const currentSid = get(sessionId);
      const currentToken = get(sessionToken);
      if (!currentSid || !currentToken) return;

      const delay = RECONNECT_DELAYS[reconnectAttempts] || RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1];
      reconnectAttempts++;
      connectionStatus.set('reconnecting');
      reconnectTimer = setTimeout(() => {
        connectSSE(currentSid, currentToken, autoReconnectEnabled);
      }, delay);
    }
  };
}

function bufferSSEContent(text) {
  sseBuffer += text;
  
  if (!sseFlushTimer) {
    sseFlushTimer = setTimeout(() => {
      if (sseBuffer.trim()) {
        appendToLastAssistant(sseBuffer);
        sseBuffer = '';
      }
      sseFlushTimer = null;
    }, SSE_FLUSH_INTERVAL);
  }
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
  // 支持字符串（兼容旧代码）或对象 { text, params }
  const payload = typeof data === 'string'
    ? { type: 'input', data: { text: data } }
    : { type: 'input', data };

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    return;
  }

  if (eventSource && eventSource.readyState === EventSource.OPEN) {
    // For SSE, we need to send via HTTP POST to /api/input
    const csrf = get(csrfToken);
    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['X-CSRF-Token'] = csrf;
    fetch('/api/input', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload.data)
    }).catch(err => console.error('Failed to send input:', err));
    return;
  }

  // WebSocket 不可用，尝试恢复连接并等待就绪
  const sid = get(sessionId);
  const token = get(sessionToken);
  if (sid && token) {
    connectWebSocket(sid, token, autoReconnectEnabled, useSSEMode);
    try {
      await waitForWsOpen(5000);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        return;
      }
    } catch (_) {
      // 等待超时，继续到错误处理
    }
  }

  // 所有方式都失败，重置等待状态
  isWaiting.set(false);
  isTyping.set(false);
  addMessage('system', '发送失败：WebSocket 连接不可用，请刷新页面重试');
}

export function disconnectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (sseFlushTimer) {
    clearTimeout(sseFlushTimer);
    sseFlushTimer = null;
  }
  sseBuffer = '';
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent reconnect
  
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
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
      // 如果之前卡在等待状态，重连后自动复位
      if (get(isWaiting)) {
        isWaiting.set(false);
        isTyping.set(false);
        addMessage('system', '连接已恢复');
      }
      break;
    case 'output':
      appendToLastAssistant(stripAnsi(msg.data || ''));
      break;
    case 'done':
      // Flush any buffered content
      if (sseBuffer.trim()) {
        appendToLastAssistant(sseBuffer);
        sseBuffer = '';
      }
      isWaiting.set(false);
      isTyping.set(false);
      break;
    case 'error':
      isWaiting.set(false);
      isTyping.set(false);
      // 服务端重启后旧 session 失效，清除凭证停止重连
      if (msg.message && msg.message.includes('Invalid session')) {
        sessionId.set(null);
        sessionToken.set(null);
        autoReconnectEnabled = false;
      }
      addMessage('system', msg.message || 'Unknown error');
      break;
    case 'model_update':
      // Update model health
      break;
    default:
      break;
  }
}
