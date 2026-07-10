/**
 * 协作功能处理器模块
 * 负责 Yjs 同步、光标状态、在线状态等消息类型
 */

import * as Y from 'yjs';

/**
 * 处理 Yjs 同步请求：返回完整的 Y.Doc 状态
 * @param {object} ws - WebSocket 连接
 * @param {object} message - 消息对象
 * @param {string} sessionId - 会话 ID
 * @param {function} getSession - 获取会话函数
 * @param {YDocManager} ydocManager - Yjs 文档管理器
 * @param {function} broadcastToSession - 广播函数
 * @param {ActivityLog} activityLog - 活动时间线记录器
 */
export function handleYjsSync(ws, message, sessionId, getSession, ydocManager, broadcastToSession, activityLog) {
  if (!sessionId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Session not initialized' }));
    return;
  }
  const syncSession = getSession(sessionId);
  if (!syncSession) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid session' }));
    return;
  }

  // 注册客户端（如果尚未注册）
  const clientId = message.clientId || ws._clientId || (ws._clientId = 'ws_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  ws._clientId = clientId;

  ydocManager.addClient(sessionId, clientId, {
    username: message.username || 'anonymous',
    color: message.color || ''
  });

  // 保存用户名到 ws 对象（断开时使用）
  ws._username = message.username || 'anonymous';

  // 设置 session 广播器（如果尚未设置）
  const state = Y.encodeStateAsUpdate(ydocManager.getOrCreateDoc(sessionId));
  ydocManager.registerBroadcaster(sessionId, (update) => {
    broadcastToSession(sessionId, {
      type: 'yjs_update',
      update: Buffer.from(update).toString('base64')
    });
  });

  // 发送完整状态给请求客户端
  ws.send(JSON.stringify({
    type: 'yjs_sync',
    state: Buffer.from(state).toString('base64'),
    clientId
  }));

  // 通知其他客户端有新用户加入
  broadcastToSession(sessionId, {
    type: 'presence',
    clients: ydocManager.getActiveClients(sessionId)
  });

  // 记录用户加入活动
  activityLog.log(sessionId, 'user_join', {
    actor: message.username || 'anonymous',
    message: `joined the session`
  });
}

/**
 * 处理 Yjs 增量更新：apply 并广播给其他客户端
 * @param {object} ws - WebSocket 连接
 * @param {object} message - 消息对象
 * @param {string} sessionId - 会话 ID
 * @param {YDocManager} ydocManager - Yjs 文档管理器
 */
export function handleYjsUpdate(ws, message, sessionId, ydocManager) {
  if (!sessionId || !message.update) return;

  const updateBuf = Buffer.from(message.update, 'base64');
  ydocManager.broadcastUpdate(sessionId, new Uint8Array(updateBuf));

  if (message.clientId) {
    ydocManager.updateActivity(message.clientId);
  }
}

/**
 * 处理光标位置更新：广播给其他客户端
 * @param {object} ws - WebSocket 连接
 * @param {object} message - 消息对象
 * @param {string} sessionId - 会话 ID
 * @param {function} broadcastToSession - 广播函数
 * @param {YDocManager} ydocManager - Yjs 文档管理器
 */
export function handleCursorUpdate(ws, message, sessionId, broadcastToSession, ydocManager) {
  if (!sessionId) return;

  broadcastToSession(sessionId, {
    type: 'cursor_update',
    clientId: message.clientId,
    username: message.username,
    color: message.color,
    position: message.position,
    selection: message.selection
  });

  if (message.clientId) {
    ydocManager.updateActivity(message.clientId);
  }
}

/**
 * 处理在线状态请求
 * @param {object} ws - WebSocket 连接
 * @param {object} message - 消息对象
 * @param {string} sessionId - 会话 ID
 * @param {function} broadcastToSession - 广播函数
 * @param {YDocManager} ydocManager - Yjs 文档管理器
 */
export function handlePresence(ws, message, sessionId, broadcastToSession, ydocManager) {
  if (!sessionId) return;

  broadcastToSession(sessionId, {
    type: 'presence',
    clients: ydocManager.getActiveClients(sessionId)
  });
}
