/**
 * 版本历史消息处理器模块
 * 负责处理版本列表、恢复、差异比较等消息类型
 */

/**
 * 将数据库行转换为版本对象
 * @param {Array} rows - 数据库查询结果
 * @returns {Array} 版本对象数组
 */
export function rowsToVersions(rows) {
  if (!rows || rows.length === 0 || !rows[0].values) return [];
  const cols = rows[0].columns;
  return rows[0].values.map(row => {
    const obj = {};
    cols.forEach((col, i) => { obj[col] = row[i]; });
    return {
      id: obj.id,
      sessionId: obj.session_id,
      messageId: obj.message_id,
      content: obj.content,
      version: obj.version,
      createdBy: obj.created_by || null,
      createdAt: obj.created_at
    };
  });
}

/**
 * 计算两个文本数组的简单差异
 * @param {string[]} linesA - 第一个文本的行数组
 * @param {string[]} linesB - 第二个文本的行数组
 * @returns {Array} 差异对象数组
 */
export function computeSimpleDiff(linesA, linesB) {
  const result = [];
  const maxLen = Math.max(linesA.length, linesB.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= linesA.length) {
      result.push({ type: 'added', line: linesB[i], lineNumber: i + 1 });
    } else if (i >= linesB.length) {
      result.push({ type: 'removed', line: linesA[i], lineNumber: i + 1 });
    } else if (linesA[i] !== linesB[i]) {
      result.push({ type: 'removed', line: linesA[i], lineNumber: i + 1 });
      result.push({ type: 'added', line: linesB[i], lineNumber: i + 1 });
    } else {
      result.push({ type: 'unchanged', line: linesA[i], lineNumber: i + 1 });
    }
  }
  return result;
}

/**
 * 处理版本列表请求
 * @param {object} ws - WebSocket 连接
 * @param {object} message - 消息对象
 * @param {string} sessionId - 会话 ID
 * @param {function} getSession - 获取会话函数
 * @param {object} db - 数据库连接
 */
export function handleVersionList(ws, message, sessionId, getSession, db) {
  if (!sessionId || !message.messageId) return;
  const session = getSession(sessionId);
  if (!session) return;

  try {
    const rows = db.exec(
      `SELECT id, session_id, message_id, content, version, created_by, created_at
       FROM message_versions WHERE session_id = ? AND message_id = ?
       ORDER BY version DESC`,
      [sessionId, message.messageId]
    );
    const versions = rowsToVersions(rows);
    ws.send(JSON.stringify({
      type: 'version_list',
      messageId: message.messageId,
      versions
    }));
  } catch (e) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Failed to load versions: ' + e.message
    }));
  }
}

/**
 * 处理版本恢复请求
 * @param {object} ws - WebSocket 连接
 * @param {object} message - 消息对象
 * @param {string} sessionId - 会话 ID
 * @param {function} getSession - 获取会话函数
 * @param {function} broadcastToSession - 广播函数
 * @param {object} db - 数据库连接
 */
export function handleVersionRestore(ws, message, sessionId, getSession, broadcastToSession, db) {
  if (!sessionId || !message.messageId || !message.version) return;
  const session = getSession(sessionId);
  if (!session) return;

  try {
    const versionNum = parseInt(message.version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid version number' }));
      return;
    }

    const rows = db.exec(
      `SELECT id, session_id, message_id, content, version, created_by, created_at
       FROM message_versions WHERE session_id = ? AND message_id = ? AND version = ?`,
      [sessionId, message.messageId, versionNum]
    );
    const versions = rowsToVersions(rows);

    if (versions.length === 0) {
      ws.send(JSON.stringify({ type: 'error', message: 'Version not found' }));
      return;
    }

    const targetVersion = versions[0];

    // 更新 messages 表
    db.run(
      'UPDATE messages SET content = ? WHERE id = ? AND sessionId = ?',
      [targetVersion.content, message.messageId, sessionId]
    );

    ws.send(JSON.stringify({
      type: 'version_restored',
      messageId: message.messageId,
      version: targetVersion
    }));

    // 通知 session 中的其他客户端
    broadcastToSession(sessionId, {
      type: 'message_updated',
      messageId: message.messageId,
      content: targetVersion.content,
      restoredFromVersion: versionNum
    });
  } catch (e) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Failed to restore version: ' + e.message
    }));
  }
}

/**
 * 处理版本差异比较请求
 * @param {object} ws - WebSocket 连接
 * @param {object} message - 消息对象
 * @param {string} sessionId - 会话 ID
 * @param {function} getSession - 获取会话函数
 * @param {object} db - 数据库连接
 */
export function handleVersionDiff(ws, message, sessionId, getSession, db) {
  if (!sessionId || !message.messageId || !message.v1 || !message.v2) return;
  const session = getSession(sessionId);
  if (!session) return;

  try {
    const v1 = parseInt(message.v1, 10);
    const v2 = parseInt(message.v2, 10);

    const rows = db.exec(
      `SELECT content, version FROM message_versions
       WHERE session_id = ? AND message_id = ? AND version IN (?, ?)
       ORDER BY version ASC`,
      [sessionId, message.messageId, v1, v2]
    );

    if (!rows || rows.length === 0 || !rows[0].values) {
      ws.send(JSON.stringify({ type: 'error', message: 'Versions not found' }));
      return;
    }

    const results = rows[0].values.map(r => ({
      content: r[0],
      version: r[1]
    }));

    if (results.length < 2) {
      ws.send(JSON.stringify({ type: 'error', message: 'One or both versions not found' }));
      return;
    }

    const lines1 = results[0].content.split('\n');
    const lines2 = results[1].content.split('\n');
    const diff = computeSimpleDiff(lines1, lines2);

    ws.send(JSON.stringify({
      type: 'version_diff',
      messageId: message.messageId,
      v1,
      v2,
      diff
    }));
  } catch (e) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Failed to compute diff: ' + e.message
    }));
  }
}
