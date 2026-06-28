/**
 * WebSocket Manager - handles real-time communication with server
 */
import { isConnected, connectionStatus, sessionId, sessionToken, csrfToken } from '$stores/session.store.js';
import { messages, addMessage, appendToLastAssistant, isWaiting, isTyping } from '$stores/chat.store.js';
import { stripAnsi } from '$lib/utils.js';
import { t } from '$lib/i18n.js';
import { get } from 'svelte/store';

let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
let autoReconnectEnabled = true;

export function connectWebSocket(sid, token, autoReconnect = true) {
  autoReconnectEnabled = autoReconnect;
  if (ws) {
    ws.onclose = null;
    ws.close();
  }

  connectionStatus.set('connecting');

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws`;

  ws = new WebSocket(url);

  ws.onopen = () => {
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
    isTyping.set(false);

    if (autoReconnectEnabled && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const currentSid = get(sessionId);
      const currentToken = get(sessionToken);
      if (!currentSid || !currentToken) return;

      const delay = RECONNECT_DELAYS[reconnectAttempts] || RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1];
      reconnectAttempts++;
      connectionStatus.set('reconnecting');
      addMessage('system', get(t)('status.reconnectingMsg', { seconds: delay / 1000, attempt: reconnectAttempts, max: MAX_RECONNECT_ATTEMPTS }));
      reconnectTimer = setTimeout(() => {
        connectWebSocket(currentSid, currentToken, autoReconnectEnabled);
      }, delay);
    }
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
  if (ws) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
        return;
      } catch (e) {
        console.error('sendInput: ws.send failed', e);
      }
    } else {
      console.warn('sendInput: ws state=' + ws.readyState + ' (0=CONNECTING,1=OPEN,2=CLOSING,3=CLOSED)');
    }
  }

  // WebSocket 不可用，尝试恢复连接并等待就绪
  const sid = get(sessionId);
  const token = get(sessionToken);
  if (sid && token) {
    connectWebSocket(sid, token, true);
    try {
      await waitForWsOpen(5000);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(payload));
          return;
        } catch (e) {
          console.error('sendInput: reconnect ws.send failed', e);
        }
      }
    } catch (_) {
      // 等待超时，继续到错误处理
    }
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
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent reconnect

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
      if (get(isWaiting)) {
        isWaiting.set(false);
        isTyping.set(false);
        addMessage('system', get(t)('status.reconnected'));
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
    case 'done':
    case 'exit':
      isWaiting.set(false);
      isTyping.set(false);
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
    default:
      break;
  }
}
