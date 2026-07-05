import { extractPythonBlocks, executePython } from '../tools/codeInterpreter.js';
import { exec } from 'child_process';
import { searchWeb } from '../tools/webSearch.js';
import { analyzeFilesFromPromptContext, stripFileBlocksFromPrompt } from '../tools/fileAnalysis.js';
import { buildPrompt } from '../runtime/promptBuilder.js';
import { getToolInstructions, isBuiltinTool, isMcpTool, parseMcpToolId } from '../tools/registry.js';
import { runHooks } from '../runtime/hooksRunner.js';
import { runFilters } from '../runtime/filterPipeline.js';
import { buildFilterList } from '../runtime/filters/index.js';
import { loadPipelines, runPipelines } from '../pipelines/index.js';
import { YDocManager } from '../collab/ydocManager.js';
import { ActivityLog } from '../collab/activityLog.js';
import * as Y from 'yjs';
import fs from 'fs/promises';
import path from 'path';

/**
 * 将 RAG 搜索结果格式化为可读文本
 */
function formatRagResults(results, query) {
  if (!results || results.length === 0) {
    return `知识库搜索 "${query}" 未找到相关结果。`;
  }

  // 归一化 RRF 分数到 [0, 1] 区间用于显示
  const maxScore = Math.max(...results.map(r => r.score ?? 0), 1e-8);

  const parts = [`知识库搜索 "${query}" 的结果 (共 ${results.length} 条):`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const headings = r.metadata?.headings?.length > 0
      ? ` [${r.metadata.headings.join(' > ')}]`
      : '';
    const filename = r.metadata?.filename
      ? ` (来源: ${r.metadata.filename})`
      : '';
    const score = r.score !== undefined
      ? ` [相关性: ${((r.score / maxScore) * 100).toFixed(0)}%]`
      : '';
    parts.push(`${i + 1}.${headings}${filename}${score}\n   ${r.text.substring(0, 500)}`);
  }
  return parts.join('\n\n');
}

/**
 * Extract write_file fenced blocks from AI output.
 * Format:
 * ```write_file
 * path: relative/file/path
 * language: txt
 *
 * file content here
 * ```
 */
function extractWriteFileBlocks(text) {
  const blocks = [];
  const regex = /```write_file\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    // Find path: line
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    if (pathIdx === -1) continue;
    const filePath = lines[pathIdx].slice(5).trim();
    // Content is everything after the metadata lines (path:, language:, etc.)
    const contentLines = lines.slice(pathIdx + 1).filter((l, i, arr) => {
      // Skip blank lines only at the beginning of content
      if (i === 0 && l.trim() === '') return false;
      return true;
    });
    // Re-filter: skip leading blank lines
    let start = 0;
    while (start < contentLines.length && contentLines[start].trim() === '') start++;
    const content = contentLines.slice(start).join('\n');
    blocks.push({ path: filePath, content });
  }
  return blocks;
}

/**
 * Extract edit_file fenced blocks from AI output.
 * Format:
 * ```edit_file
 * path: relative/file/path
 * <<<<<<< SEARCH
 * old content
 * =======
 * new content
 * >>>>>>>
 * ```
 */
function extractEditFileBlocks(text) {
  const blocks = [];
  const regex = /```edit_file\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    if (pathIdx === -1) continue;
    const filePath = lines[pathIdx].slice(5).trim();
    // Find SEARCH/REPLACE markers
    const searchStart = lines.findIndex(l => l.includes('<<<<<<< SEARCH') || l.includes('<<<<<<<'));
    const divider = lines.findIndex(l => l.startsWith('======='));
    const replaceEnd = lines.findIndex(l => l.startsWith('>>>>>>>'));
    if (searchStart === -1 || divider === -1 || replaceEnd === -1) continue;
    const searchStr = lines.slice(searchStart + 1, divider).join('\n').trim();
    const replaceStr = lines.slice(divider + 1, replaceEnd).join('\n').trim();
    if (!searchStr) continue;
    blocks.push({ path: filePath, searchStr, replaceStr });
  }
  return blocks;
}

/**
 * Extract delete_file fenced blocks from AI output.
 * Format:
 * ```delete_file
 * path: relative/file/path
 * ```
 */
function extractDeleteFileBlocks(text) {
  const blocks = [];
  const regex = /```delete_file\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    if (pathIdx === -1) continue;
    const filePath = lines[pathIdx].slice(5).trim();
    if (!filePath) continue;
    blocks.push({ path: filePath });
  }
  return blocks;
}

/**
 * Extract rename_file fenced blocks from AI output.
 * Format:
 * ```rename_file
 * path: old/relative/file/path
 * newPath: new/relative/file/path
 * ```
 */
function extractRenameFileBlocks(text) {
  const blocks = [];
  const regex = /```rename_file\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    if (pathIdx === -1) continue;
    const oldPath = lines[pathIdx].slice(5).trim();
    const newPathIdx = lines.findIndex(l => l.startsWith('newPath:'));
    if (newPathIdx === -1) continue;
    const newPath = lines[newPathIdx].slice(8).trim();
    if (!oldPath || !newPath) continue;
    blocks.push({ path: oldPath, newPath });
  }
  return blocks;
}

/**
 * Extract list_files fenced blocks from AI output.
 * Format:
 * ```list_files
 * path: optional/sub/directory
 * ```
 */
function extractListFilesBlocks(text) {
  const blocks = [];
  const regex = /```list_files\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    const dirPath = pathIdx !== -1 ? lines[pathIdx].slice(5).trim() : '';
    blocks.push({ path: dirPath || '.' });
  }
  return blocks;
}

/**
 * Recursively list files in a directory, returning relative paths.
 */
async function listFilesRecursive(dirPath, basePath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(basePath, fullPath);
    if (entry.isDirectory()) {
      results.push(relPath + '/');
      const sub = await listFilesRecursive(fullPath, basePath);
      results.push(...sub);
    } else {
      const stat = await fs.stat(fullPath);
      const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)} KB` : `${stat.size} B`;
      results.push(`${relPath} (${size})`);
    }
  }
  return results.sort();
}

export function applyPreToolUseHook(toolName, args, pluginsConfig = {}) {
  const hooksCtx = runHooks('preToolUse', { toolName, arguments: args }, pluginsConfig);
  return hooksCtx.arguments || args;
}

export function getRagSearchCollection(session) {
  if (!session?.id) throw new Error('Invalid session for RAG search');
  return session.id;
}

// 等待用户审批的工具请求（用 approvalId 索引）
const pendingApprovals = new Map();

// 进程序号生成器（用于检测过时进程的 close 事件）
let processSeqId = 0;

/**
 * Creates a WebSocket connection handler.
 * @param {object} deps - Dependency injection
 * @param {function} deps.getSession
 * @param {Map} deps.sessions
 * @param {Map} deps.sessionProcesses
 * @param {Map} deps.sessionProxies
 * @param {Map} deps.sessionClients
 * @param {Map} deps.wsProcCount
 * @param {function} deps.broadcastToSession
 * @param {function} deps.spawnCli
 * @param {function} deps.maskSensitive
 * @param {function} deps.stripAnsi
 * @param {function} deps.checkRateLimit
 * @param {string[]} deps.ALLOWED_ORIGINS
 * @param {number} deps.RATE_WINDOW
 * @param {number} deps.RATE_MAX_INPUT
 */
export function createWsHandler(deps) {
  // ===== Yjs 协作文档管理器（所有 WebSocket 连接共享同一实例） =====
  const ydocManager = new YDocManager({
    docsDir: deps.docsDir || './ydocs'
  });

  // ===== 活动时间线记录器 (T5) =====
  const activityLog = deps.activityLog || new ActivityLog({ db: deps.db });

  // ===== 版本历史辅助函数 (T5) =====
  function rowsToVersions(rows) {
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

  function computeSimpleDiff(linesA, linesB) {
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
   * Take a snapshot of all file hashes in a directory
   * Returns: Map<filePath, { hash: string, content: string }>
   */
  async function takeFileSnapshot(dirPath) {
    const snapshot = new Map();
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules') continue;
        if (entry.isDirectory() && entry.name.startsWith('.')) continue;
        if (entry.name === '.env') continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const subSnapshot = await takeFileSnapshot(fullPath);
          for (const [k, v] of subSnapshot) {
            snapshot.set(path.relative(dirPath, path.join(dirPath, entry.name, k)), v);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          // Track text files by trying UTF-8 read; skip binaries
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            // Confirm it's text: skip if content has null bytes (binary)
            if (content.includes('\0')) continue;
            const crypto = await import('crypto');
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            snapshot.set(path.relative(dirPath, fullPath), { hash, content });
          } catch {} // skip binary/unreadable files
        }
      }
    } catch {}
    return snapshot;
  }

  /**
   * Detect changed files and create version entries
   * Returns: Array of { filePath, changes, fromVersion, toVersion, summary }
   */
  async function detectChangedFiles(session, preExecSnapshot, db) {
    const results = [];
    const currentSnapshot = await takeFileSnapshot(session.dir);

    for (const [filePath, preData] of preExecSnapshot) {
      const currentData = currentSnapshot.get(filePath);
      if (!currentData) continue; // file was deleted, skip for now

      if (preData.hash !== currentData.hash) {
        // File changed! Create version entries
        const oldContent = preData.content;
        const newContent = currentData.content;

        // Save old version to DB
        let oldVersionId = null;
        try {
          const { randomUUID, createHash } = await import('crypto');
          const oldHash = createHash('sha256').update(oldContent).digest('hex');
          const oldId = randomUUID();
          db.run(
            `INSERT INTO file_versions (id, sessionId, filePath, content, hash, size, createdAt, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [oldId, session.id, filePath, oldContent, oldHash, Buffer.byteLength(oldContent, 'utf-8'), Date.now(), 'pre-exec']
          );
          oldVersionId = oldId;

          // Save new version
          const newHash = createHash('sha256').update(newContent).digest('hex');
          const newId = randomUUID();
          db.run(
            `INSERT INTO file_versions (id, sessionId, filePath, content, hash, size, createdAt, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [newId, session.id, filePath, newContent, newHash, Buffer.byteLength(newContent, 'utf-8'), Date.now(), 'post-exec']
          );

          // Compute diff
          const { diffLines } = await import('diff');
          const changes = diffLines(oldContent, newContent);

          const added = changes.filter(c => c.added).reduce((s, c) => s + (c.count || 0), 0);
          const removed = changes.filter(c => c.removed).reduce((s, c) => s + (c.count || 0), 0);

          // Compute line numbers for each diff chunk
          let newLineNum = 1;
          let oldLineNum = 1;
          const changesWithLines = changes.map(c => {
            const chunk = {
              count: c.count,
              added: c.added || false,
              removed: c.removed || false,
              value: c.value,
              startLine: newLineNum
            };
            if (c.removed) {
              chunk.oldStartLine = oldLineNum;
              oldLineNum += c.count;
            } else if (c.added) {
              newLineNum += c.count;
            } else {
              newLineNum += c.count;
              oldLineNum += c.count;
            }
            return chunk;
          });

          results.push({
            filePath,
            changes: changesWithLines,
            fromVersion: oldId,
            toVersion: newId,
            summary: `+${added} -${removed} in ${filePath}`
          });
        } catch (e) {
          console.error('[FILE DIFF] Error creating version:', e.message);
        }
      }
    }

    // Also detect newly created files
    for (const [filePath, curData] of currentSnapshot) {
      if (preExecSnapshot.has(filePath)) continue;

      try {
        const { randomUUID, createHash } = await import('crypto');
        const newHash = createHash('sha256').update(curData.content).digest('hex');
        const newId = randomUUID();
        db.run(
          `INSERT INTO file_versions (id, sessionId, filePath, content, hash, size, createdAt, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId, session.id, filePath, curData.content, newHash, Buffer.byteLength(curData.content, 'utf-8'), Date.now(), 'post-exec']
        );

        const lines = curData.content.split('\n');
        const added = lines.filter(l => l.trim()).length;
        results.push({
          filePath,
          changes: [{ count: lines.length, added: true, value: curData.content, startLine: 1 }],
          fromVersion: null,
          toVersion: newId,
          summary: `+${added} lines (new file) in ${filePath}`
        });
      } catch (e) {
        console.error('[FILE DIFF] Error creating version for new file:', e.message);
      }
    }

    return results;
  }

  return function handleConnection(ws, req) {
    const {
      getSession, sessions, sessionProcesses, sessionProxies, sessionClients, wsProcCount,
      broadcastToSession, spawnCli, maskSensitive, stripAnsi,
      checkRateLimit, ALLOWED_ORIGINS, RATE_WINDOW, RATE_MAX_INPUT,
      messageStore, mcpManager, rag, agentConfig, db
    } = deps;
    const pluginsConfig = (agentConfig && agentConfig.plugins) || {};
    const filtersConfig = (agentConfig && agentConfig.filters) || {};
    const filterPipeline = buildFilterList(filtersConfig);

    // 加载外部管道脚本（非阻塞）
    let pipelines = [];
    loadPipelines().then(p => { pipelines = p; }).catch(() => {});

    // Verify WebSocket origin
    const wsOrigin = req.headers.origin;
    if (!wsOrigin || !ALLOWED_ORIGINS.includes(wsOrigin)) {
      ws.send(JSON.stringify({ type: 'error', message: 'WebSocket origin not allowed' }));
      ws.close();
      return;
    }

    let sessionId = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (data) => {
      let isInputMessage = false;
      try {
        const message = JSON.parse(data.toString());

        // ===== 工具审批回复：需要优先于其他消息处理 =====
        if (message.type === 'tool_approval_response') {
          const { approvalId, approved } = message;
          const pending = pendingApprovals.get(approvalId);
          if (pending) {
            pending.resolve(approved ? pending.tools : []);
          }
          return;
        }

        // ===== 心跳 ping/pong =====
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        // ===== 执行 Bash 命令（来自 AI 代码块的允许执行按钮） =====
        if (message.type === 'run_bash_command') {
          const command = message.command;
          if (!command || typeof command !== 'string') {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid command' }));
            return;
          }
          const bashSession = getSession(sessionId);
          const bashCwd = bashSession ? bashSession.dir : process.cwd();
          const preExecSnapshot = bashSession ? await takeFileSnapshot(bashSession.dir) : new Map();
          broadcastToSession(sessionId, { type: 'output', data: `\n[执行命令] $ ${command}\n` });
          exec(command, {
            cwd: bashCwd,
            timeout: 30000,
            maxBuffer: 1024 * 1024
          }, async (err, stdout, stderr) => {
            if (stdout) {
              broadcastToSession(sessionId, { type: 'output', data: stdout + '\n' });
            }
            if (stderr) {
              broadcastToSession(sessionId, { type: 'output', data: stderr + '\n' });
            }
            if (err) {
              broadcastToSession(sessionId, { type: 'output', data: `\n[命令退出码: ${err.code || 1}]\n` });
            } else {
              broadcastToSession(sessionId, { type: 'output', data: `\n[命令执行完毕]\n` });
            }
            // Detect file changes after command execution
            if (bashSession) {
              try {
                const changedFiles = await detectChangedFiles(bashSession, preExecSnapshot, db);
                if (changedFiles.length > 0) {
                  broadcastToSession(sessionId, { type: 'file_diff', diffs: changedFiles });
                }
              } catch (e) {
                console.error('[FILE DIFF] Error detecting changes:', e.message);
              }
            }
          });
          return;
        }

        // ===== 加载更早的历史消息 =====
        if (message.type === 'load_more') {
          const page = message.page || 0;
          if (sessionId && messageStore) {
            const pageData = await messageStore.loadMessagesPaginated(sessionId, page);
            ws.send(JSON.stringify({
              type: 'history_page',
              messages: pageData.messages,
              page: pageData.page,
              totalPages: pageData.totalPages,
              hasMore: pageData.hasMore
            }));
          }
          return;
        }

        if (message.type === 'init') {
          sessionId = message.sessionId;
          const token = message.token;
          const session = getSession(sessionId, token);
          if (!session) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid session or token' }));
            ws.close();
            return;
          }

          // Register client for model health push and process output
          if (!sessionClients.has(sessionId)) sessionClients.set(sessionId, new Set());
          sessionClients.get(sessionId).add(ws);

          // 如果 session 有正在运行中的进程，把新 ws 注册到进程输出流
          const runningProc = sessionProcesses.get(sessionId);
          if (runningProc) {
            console.log('Session ' + sessionId + ' reconnected, re-associating process output');
          }

          console.log('Session ' + sessionId + ' initialized');
          ws.send(JSON.stringify({
            type: 'ready',
            model: session.currentModel,
            health: session.modelHealth
          }));

          // 发送历史消息（分页，先发最新一页）
          if (messageStore) {
            const pageData = await messageStore.loadMessagesPaginated(sessionId, 0);
            if (pageData.messages.length > 0) {
              ws.send(JSON.stringify({
                type: 'history',
                messages: pageData.messages,
                page: pageData.page,
                totalPages: pageData.totalPages,
                hasMore: pageData.hasMore
              }));
              console.log('[HISTORY] sent ' + pageData.messages.length + ' messages (page 1/' + pageData.totalPages + ') to client');
            }
          }

        } else if (message.type === 'update_filters') {
          // ===== 动态更新过滤器配置 =====
          if (message.config && typeof message.config === 'object') {
            Object.keys(message.config).forEach((key) => {
              const filterCfg = message.config[key];
              // 只更新 filters 中已定义的 key
              if (filtersConfig[key] !== undefined || key === 'contextInject' || key === 'profanity' || key === 'formatGuard') {
                filtersConfig[key] = { ...(filtersConfig[key] || {}), ...filterCfg };
              }
            });
            // 重建过滤器管道
            filterPipeline.length = 0;
            filterPipeline.push(...buildFilterList(filtersConfig));
            console.log('[FILTERS] config updated, pipeline rebuilt:', Object.keys(filtersConfig).map(k => k + '=' + filtersConfig[k]?.enabled).join(', '));
          }

        } else if (message.type === 'input') {
          const session = getSession(sessionId);
          if (!session) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid session' }));
            return;
          }

          // Rate limit
          if (!checkRateLimit('input:' + sessionId, RATE_MAX_INPUT, RATE_WINDOW)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Too many requests. Please slow down.' }));
            return;
          }

          // Session token re-validation on input
          if (message.token && session.token !== message.token) {
            ws.send(JSON.stringify({ type: 'error', message: 'Session token mismatch' }));
            return;
          }

          // Max 2 concurrent processes per session
          const currentCount = wsProcCount.get(sessionId) || 0;
          if (currentCount >= 2) {
            ws.send(JSON.stringify({ type: 'error', message: 'Already processing. Wait for completion.' }));
            return;
          }

          const oldProc = sessionProcesses.get(sessionId);
          if (oldProc) oldProc.kill();
          const oldProxy = sessionProxies.get(sessionId);
          if (oldProxy) { oldProxy.kill(); sessionProxies.delete(sessionId); }

          // message.data 可能是字符串或对象 { text, files, images, tools }
          const originalPrompt = typeof message.data === 'string' ? message.data : message.data.text;
          let prompt = originalPrompt;
          const tools = (typeof message.data === 'object' ? message.data.tools : null) || [];
          const toolResults = [];
          let userMessageForPrompt = originalPrompt;

          // 保存用户消息
          if (messageStore && originalPrompt && originalPrompt.trim()) {
            await messageStore.saveMessage(sessionId, { role: 'user', content: originalPrompt });

            // 记录消息发送活动
            activityLog.log(sessionId, 'message_send', {
              actor: ws._username || 'anonymous',
              message: originalPrompt.slice(0, 100) + (originalPrompt.length > 100 ? '...' : '')
            });
          }

          // ===== 工具审批流程 =====
          let approvedTools = tools; // 默认全部批准（无审批流程时保持原行为）
          let approvalWasTriggered = false;
          if (tools.length > 0) {
            approvalWasTriggered = true;
            const approvalId = sessionId + '_' + Date.now();
            const approvalPromise = new Promise((resolve) => {
              const timeout = setTimeout(() => {
                pendingApprovals.delete(approvalId);
                resolve([]); // 超时自动拒绝全部
              }, 120000); // 2 分钟超时（给用户充分审批时间）

              pendingApprovals.set(approvalId, {
                resolve: (approved) => {
                  clearTimeout(timeout);
                  pendingApprovals.delete(approvalId);
                  resolve(approved);
                },
                _timeout: timeout,
                tools,
                sessionId
              });
            });

            broadcastToSession(sessionId, {
              type: 'tool_approval_request',
              approvalId,
              tools: tools.map(t => ({
                id: t,
                label: t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
              }))
            });

            approvedTools = await approvalPromise;
          }

          // 执行已批准的工具
          if (approvedTools && approvedTools.length > 0) {
            for (const toolId of approvedTools) {
              if (toolId === 'web_search' && originalPrompt && originalPrompt.trim()) {
                broadcastToSession(sessionId, { type: 'output', data: '\n[正在搜索...]\n' });
                const result = await searchWeb(originalPrompt);
                if (result.content) toolResults.push(result);
                console.log('[WEB_SEARCH] results length: ' + (result.content ? result.content.length : 0) + ' chars');
              }

              if (toolId === 'rag_search' && originalPrompt && originalPrompt.trim() && rag) {
                broadcastToSession(sessionId, { type: 'output', data: '\n[正在搜索知识库...]\n' });
                const collection = getRagSearchCollection(session);
                try {
                  const results = await rag.search(collection, originalPrompt, {
                    topK: 5,
                    bm25Weight: 0.3,
                    enableRerank: false,
                  });
                  const content = formatRagResults(results, originalPrompt);
                  toolResults.push({
                    tool: 'rag_search',
                    ok: true,
                    content,
                    sources: results.map(r => ({
                      text: r.text.substring(0, 80),
                      score: r.score,
                      metadata: r.metadata,
                    })),
                    metadata: { query: originalPrompt, resultCount: results.length },
                  });
                  console.log('[RAG_SEARCH] results: ' + results.length + ' chunks');
                } catch (e) {
                  console.error('[RAG_SEARCH] Error:', e.message);
                  toolResults.push({
                    tool: 'rag_search',
                    ok: false,
                    content: '[知识库搜索失败: ' + e.message + ']',
                    metadata: { query: originalPrompt, error: e.message },
                  });
                }
              }

              if (toolId === 'file_analysis' && originalPrompt && originalPrompt.trim()) {
                const fileAnalysis = analyzeFilesFromPromptContext(originalPrompt);
                if (fileAnalysis.content) {
                  toolResults.push(fileAnalysis);
                  userMessageForPrompt = stripFileBlocksFromPrompt(originalPrompt);
                }
              }

              // MCP tool execution
              if (isMcpTool(toolId) && mcpManager) {
                const parsed = parseMcpToolId(toolId);
                if (parsed) {
                  broadcastToSession(sessionId, { type: 'output', data: `\n[执行 MCP 工具: ${parsed.serverName}/${parsed.toolName}...]\n` });
                  const toolArgs = applyPreToolUseHook(toolId, { query: originalPrompt }, pluginsConfig);
                  const { _instruction, ...cleanArgs } = toolArgs;
                  const result = await mcpManager.callTool(parsed.serverName, parsed.toolName, cleanArgs);
                  if (result.content) {
                    toolResults.push({
                      type: 'tool_result',
                      tool: toolId,
                      content: result.content,
                      isError: result.isError
                    });
                  }
                }
              }
            }
          }
          // 无论是否批准工具，都发送完成信号关闭审批弹窗
          if (approvalWasTriggered) {
            broadcastToSession(sessionId, { type: 'tool_approval_complete' });
          }

          // Build prompt with MCP tool instructions too
          let toolInstructions = getToolInstructions(approvedTools || []);

          // 始终注入默认工具指令（Kun 风格：默认启用，无需审批）
          toolInstructions += '\n' + [
            'You can execute Python code for calculations and data analysis. When useful, provide executable Python code in a fenced python code block.',
            '',
            'You can write files directly to disk using Node.js fs.writeFile. Use this instead of bash echo/redirect when creating or overwriting files. Output in the following format:',
            '',
            '```write_file',
            'path: relative/file/path',
            'language: file_extension',
            '',
            'The file content goes here...',
            '```',
            '',
            'You can edit existing files using search-and-replace. Output in the following format:',
            '',
            '```edit_file',
            'path: relative/file/path',
            '<<<<<<< SEARCH',
            'old content to replace',
            '=======',
            'new content to replace with',
            '>>>>>>>',
            '```',
            '',
            'You can delete files. Output in the following format:',
            '',
            '```delete_file',
            'path: relative/file/path',
            '```',
            '',
            'You can rename/move files. Output in the following format:',
            '',
            '```rename_file',
            'path: old/relative/file/path',
            'newPath: new/relative/file/path',
            '```',
            '',
            'You can list files in a directory. Output in the following format:',
            '',
            '```list_files',
            'path: optional/sub/directory (omit path: to list root)',
            '```'
          ].join('\n');

          if (mcpManager && mcpManager.isConnected()) {
            const mcpTools = await mcpManager.listTools();
            for (const mcpTool of mcpTools) {
              if (approvedTools.includes(mcpTool.id)) {
                toolInstructions += '\n' + mcpTool.instruction;
              }
            }
          }

          // === Agent 钩子：修改用户提示 ===
          const hooksCtx = runHooks('onUserPrompt', { prompt: userMessageForPrompt }, pluginsConfig);
          userMessageForPrompt = hooksCtx.prompt;

          // === Agent 钩子：改写工具结果 ===
          for (let i = 0; i < toolResults.length; i++) {
            const tr = toolResults[i];
            const postCtx = runHooks('postToolUse', {
              toolName: tr.tool || tr.type || '',
              result: tr.content || ''
            }, pluginsConfig);
            if (postCtx.result !== tr.content) {
              toolResults[i] = { ...tr, content: postCtx.result };
            }
          }

          // === Pipelines: 输入管道 (用户自定义脚本) ===
          if (pipelines.length > 0) {
            const pipeResult = await runPipelines('input', userMessageForPrompt, {
              session,
              context: { rag, filterOptions: filtersConfig }
            }, pipelines);
            if (pipeResult.content !== userMessageForPrompt) {
              userMessageForPrompt = pipeResult.content;
            }
          }

          // === Filters: 输入过滤器 (contextInject) ===
          if (filterPipeline.length > 0) {
            const inputFilters = filterPipeline.filter((f) => f.type === 'input' || !f.type);
            if (inputFilters.length > 0) {
              const filterCtx = await runFilters('input', userMessageForPrompt, {
                session,
                context: { rag, filterOptions: filtersConfig }
              }, inputFilters);
              if (!filterCtx.aborted) {
                userMessageForPrompt = filterCtx.content;
              }
            }
          }

          prompt = buildPrompt({
            toolInstructions,
            activeToolIds: approvedTools || [],
            toolResults,
            userMessage: userMessageForPrompt,
            history: messageStore ? (await messageStore.loadMessages(sessionId)).slice(0, -1) : [],
            enableCompaction: true,
            maxHistoryChars: 8000,
          });

          console.log('[INPUT] prompt length: ' + (prompt ? prompt.length : 0) + ', tools: [' + tools.join(',') + ']');

          wsProcCount.set(sessionId, (wsProcCount.get(sessionId) || 0) + 1);
          isInputMessage = true;
          // Take file snapshot before command execution
          const preExecSnapshot = await takeFileSnapshot(session.dir);
          const proc = await spawnCli(session, prompt);
          proc._procSeq = ++processSeqId;
          sessionProcesses.set(sessionId, proc);

          // ===== 代码解释器：缓冲完整输出，关闭时检测 Python 代码块 =====
          let codeInterpreterBuffer = '';
          // 累积 AI 输出，关闭时保存完整消息
          let assistantBuffer = '';

          proc.stdout.on('data', (chunk) => {
            let clean = stripAnsi(chunk.toString());
            clean = maskSensitive(clean, session.apiKey);
            if (clean.trim()) {
              assistantBuffer += clean;
              codeInterpreterBuffer += clean;
              const MAX_WS_MSG = 1024 * 1024;
              const data = clean.length > MAX_WS_MSG ? clean.substring(0, MAX_WS_MSG) + '\n[output truncated]' : clean;
              broadcastToSession(sessionId, { type: 'output', data });
            }
          });

          proc.stderr.on('data', (chunk) => {
            let errStr = chunk.toString();
            errStr = maskSensitive(errStr, session.apiKey);
            assistantBuffer += errStr;
            codeInterpreterBuffer += errStr;
            console.error('[STDERR] ' + maskSensitive(errStr.substring(0, 200), session.apiKey));
            const MAX_WS_ERR = 1024 * 1024;
            const data = errStr.length > MAX_WS_ERR ? errStr.substring(0, MAX_WS_ERR) + '\n[output truncated]' : errStr;
            broadcastToSession(sessionId, { type: 'stderr', data });
          });

          proc.on('close', async (code) => {
            console.log('[DONE] exit code ' + code);

            // 检测是否已被新进程替代：如果是旧进程的 close，跳过所有副作用
            const currentProc = sessionProcesses.get(sessionId);
            if (currentProc !== proc) {
              return;
            }

            sessionProcesses.delete(sessionId);
            wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));

            // Kill proxy too
            const proxy = sessionProxies.get(sessionId);
            if (proxy) { proxy.kill(); sessionProxies.delete(sessionId); }

            // ===== 代码解释器：执行 Python 代码块 =====
            if (codeInterpreterBuffer.trim()) {
              const blocks = extractPythonBlocks(codeInterpreterBuffer);
              if (blocks.length > 0) {
                for (let i = 0; i < blocks.length; i++) {
                  broadcastToSession(sessionId, { type: 'output', data: `\n[执行 Python 代码块 ${i + 1}/${blocks.length}...]\n` });
                  const result = await executePython(blocks[i]);
                  let output = `\n[代码块 ${i + 1} 执行完毕]`;
                  if (result.stdout) output += `\n输出:\n${result.stdout}`;
                  if (result.stderr) output += `\n错误:\n${result.stderr}`;
                  if (result.exitCode !== 0) output += `\n退出码: ${result.exitCode}`;
                  broadcastToSession(sessionId, { type: 'output', data: output + '\n' });
                }
              }
            }

            // ===== Write File Tool：提取 write_file / edit_file 代码块并直接写入 =====
            if (assistantBuffer.trim()) {
              const writeBlocks = extractWriteFileBlocks(assistantBuffer);
              const editBlocks = extractEditFileBlocks(assistantBuffer);

              for (const block of writeBlocks) {
                const fullPath = path.resolve(session.dir, block.path);
                // 安全检查：必须在工作目录内
                if (!fullPath.startsWith(path.resolve(session.dir))) {
                  broadcastToSession(sessionId, { type: 'output', data: `\n[Write File 拒绝] 路径 ${block.path} 不在允许的工作目录内\n` });
                  continue;
                }
                try {
                  await fs.mkdir(path.dirname(fullPath), { recursive: true });
                  await fs.writeFile(fullPath, block.content, 'utf-8');
                  broadcastToSession(sessionId, { type: 'output', data: `\n[文件已写入] ${block.path} (${block.content.length} 字符)\n` });
                } catch (err) {
                  broadcastToSession(sessionId, { type: 'output', data: `\n[文件写入失败] ${block.path}: ${err.message}\n` });
                }
              }

              for (const block of editBlocks) {
                const fullPath = path.resolve(session.dir, block.path);
                if (!fullPath.startsWith(path.resolve(session.dir))) {
                  broadcastToSession(sessionId, { type: 'output', data: `\n[Edit File 拒绝] 路径 ${block.path} 不在允许的工作目录内\n` });
                  continue;
                }
                try {
                  const currentContent = await fs.readFile(fullPath, 'utf-8');
                  if (!currentContent.includes(block.searchStr)) {
                    broadcastToSession(sessionId, { type: 'output', data: `\n[编辑失败] ${block.path}: 未找到匹配的原文\n` });
                    continue;
                  }
                  const newContent = currentContent.replace(block.searchStr, block.replaceStr);
                  if (newContent === currentContent) {
                    broadcastToSession(sessionId, { type: 'output', data: `\n[编辑失败] ${block.path}: 替换后内容无变化\n` });
                    continue;
                  }
                  await fs.writeFile(fullPath, newContent, 'utf-8');
                  broadcastToSession(sessionId, { type: 'output', data: `\n[文件已编辑] ${block.path}\n` });
                } catch (err) {
                  broadcastToSession(sessionId, { type: 'output', data: `\n[文件编辑失败] ${block.path}: ${err.message}\n` });
                }
              }

              // ===== File Management Tools：提取 delete_file / rename_file / list_files 代码块并执行 =====
              const deleteBlocks = extractDeleteFileBlocks(assistantBuffer);
              const renameBlocks = extractRenameFileBlocks(assistantBuffer);
              const listBlocks = extractListFilesBlocks(assistantBuffer);

              for (const block of deleteBlocks) {
                const fullPath = path.resolve(session.dir, block.path);
                if (!fullPath.startsWith(path.resolve(session.dir))) {
                  broadcastToSession(sessionId, { type: 'output', data: `\n[Delete File 拒绝] 路径 ${block.path} 不在允许的工作目录内\n` });
                  continue;
                }
                try {
                  await fs.unlink(fullPath);
                  broadcastToSession(sessionId, { type: 'output', data: `\n[文件已删除] ${block.path}\n` });
                } catch (err) {
                  broadcastToSession(sessionId, { type: 'output', data: `\n[文件删除失败] ${block.path}: ${err.message}\n` });
                }
              }

              for (const block of renameBlocks) {
                const oldFullPath = path.resolve(session.dir, block.path);
                const newFullPath = path.resolve(session.dir, block.newPath);
                if (!oldFullPath.startsWith(path.resolve(session.dir)) || !newFullPath.startsWith(path.resolve(session.dir))) {
                  broadcastToSession(sessionId, { type: 'output', data: `\n[Rename File 拒绝] 路径不在允许的工作目录内\n` });
                  continue;
                }
                try {
                  await fs.mkdir(path.dirname(newFullPath), { recursive: true });
                  await fs.rename(oldFullPath, newFullPath);
                  broadcastToSession(sessionId, { type: 'output', data: `\n[文件已重命名] ${block.path} → ${block.newPath}\n` });
                } catch (err) {
                  broadcastToSession(sessionId, { type: 'output', data: `\n[文件重命名失败] ${block.path}: ${err.message}\n` });
                }
              }

              for (const block of listBlocks) {
                const dirPath = path.resolve(session.dir, block.path);
                if (!dirPath.startsWith(path.resolve(session.dir))) {
                  broadcastToSession(sessionId, { type: 'output', data: `\n[List Files 拒绝] 路径 ${block.path} 不在允许的工作目录内\n` });
                  continue;
                }
                try {
                  const files = await listFilesRecursive(dirPath, session.dir);
                  let output = `\n[目录列表] ${block.path === '.' ? '/' : block.path}\n`;
                  for (const f of files) {
                    output += `  ${f}\n`;
                  }
                  broadcastToSession(sessionId, { type: 'output', data: output });
                } catch (err) {
                  broadcastToSession(sessionId, { type: 'output', data: `\n[目录列表失败] ${block.path}: ${err.message}\n` });
                }
              }
            }

            // === Pipelines: 输出管道 (用户自定义脚本) ===
            if (pipelines.length > 0 && assistantBuffer.trim()) {
              const pipeResult = await runPipelines('output', assistantBuffer, {
                session,
                context: { filterOptions: filtersConfig }
              }, pipelines);
              if (pipeResult.content !== assistantBuffer) {
                assistantBuffer = pipeResult.content;
              }
            }

            // === Filters: 输出过滤器 (profanity, formatGuard) ===
            let outputFilterAborted = false;
            if (filterPipeline.length > 0 && assistantBuffer.trim()) {
              const outputFilters = filterPipeline.filter((f) => f.type === 'output' || !f.type);
              if (outputFilters.length > 0) {
                const outputFilterCtx = await runFilters('output', assistantBuffer, {
                  session,
                  context: { filterOptions: filtersConfig }
                }, outputFilters);
                if (outputFilterCtx.aborted) {
                  outputFilterAborted = true;
                  // 阻断内容不保存，且告知客户端
                  broadcastToSession(sessionId, {
                    type: 'output',
                    data: '\n[输出已被过滤器阻断: ' + outputFilterCtx.reason + ']\n'
                  });
                } else if (outputFilterCtx.content !== assistantBuffer) {
                  broadcastToSession(sessionId, {
                    type: 'output',
                    data: '\n[输出已通过过滤器处理]\n'
                  });
                  assistantBuffer = outputFilterCtx.content;
                }
              }
            }

            broadcastToSession(sessionId, { type: 'exit', code });
            broadcastToSession(sessionId, { type: 'done' });

            // Detect file changes and send diffs
            const changedFiles = await detectChangedFiles(session, preExecSnapshot, db);
            if (changedFiles.length > 0) {
              broadcastToSession(sessionId, { type: 'file_diff', diffs: changedFiles });
            }

            // 保存助理消息（仅在未阻断时保存）
            if (messageStore && assistantBuffer.trim() && !outputFilterAborted) {
              await messageStore.saveMessage(sessionId, { role: 'assistant', content: assistantBuffer.trim() });
            }
          });

          proc.on('error', (err) => {
            console.error('[ERROR] ' + err.message);
            wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'error', message: 'Failed to start CLI' }));
            }
          });
        } else if (message.type === 'parallel_start') {
          // ===== 并行模型调用 =====
          const session = getSession(sessionId);
          if (!session) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid session' }));
            return;
          }

          const { modelIds, prompt: parallelPrompt } = message;
          if (!Array.isArray(modelIds) || modelIds.length < 2 || modelIds.length > 4) {
            ws.send(JSON.stringify({ type: 'error', message: 'Select 2-4 models for parallel comparison' }));
            return;
          }
          if (!parallelPrompt || !parallelPrompt.trim()) {
            ws.send(JSON.stringify({ type: 'error', message: 'Prompt is required' }));
            return;
          }

          // 异步启动并行引擎（不阻塞 WebSocket 消息循环）
          (async () => {
            const { ParallelEngine } = await import('../parallel/index.js');
            const engine = new ParallelEngine(session, agentConfig);

            ws.send(JSON.stringify({
              type: 'parallel_started',
              modelIds,
              timestamp: Date.now()
            }));

            engine
              .onChunk(({ modelId, text, done }) => {
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: 'parallel_chunk', modelId, text, done }));
                }
              })
              .onModelDone(({ modelId, status, latency, tokens, error }) => {
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: 'parallel_model_done', modelId, status, latency, tokens, error }));
                }
              })
              .onAllDone(({ results, summary }) => {
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: 'parallel_all_done', results, summary }));
                }
              });

            try {
              await engine.start(parallelPrompt, modelIds);
            } catch (e) {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'parallel_error', message: e.message }));
              }
            } finally {
              engine.dispose();
            }
          })();
        } else if (message.type === 'yjs_sync') {
          // ===== Yjs 同步请求：返回完整的 Y.Doc 状态 =====
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

        } else if (message.type === 'yjs_update') {
          // ===== Yjs 增量更新：apply 并广播给其他客户端 =====
          if (!sessionId || !message.update) return;

          const updateBuf = Buffer.from(message.update, 'base64');
          ydocManager.broadcastUpdate(sessionId, new Uint8Array(updateBuf));

          if (message.clientId) {
            ydocManager.updateActivity(message.clientId);
          }

        } else if (message.type === 'cursor_update') {
          // ===== 光标位置更新：广播给其他客户端 =====
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

        } else if (message.type === 'presence') {
          // ===== 在线状态广播 =====
          if (!sessionId) return;

          broadcastToSession(sessionId, {
            type: 'presence',
            clients: ydocManager.getActiveClients(sessionId)
          });

        // ===== 版本历史相关消息 (T5) =====
        } else if (message.type === 'version_list') {
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

        } else if (message.type === 'version_restore') {
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

        } else if (message.type === 'version_diff') {
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

      } catch (error) {
        console.error('WebSocket error:', error);
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: error.message || 'Internal server error' }));
        }
        // 仅 input 消息才需要清理进程计数
        if (isInputMessage && sessionId && wsProcCount) {
          wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] error:', err.message);
    });

    ws.on('close', () => {
      if (sessionId) {
        // Clean up pending approvals for this session
        for (const [approvalId, pending] of pendingApprovals) {
          if (approvalId.startsWith(sessionId + '_')) {
            clearTimeout(pending._timeout);
            pendingApprovals.delete(approvalId);
          }
        }

        // 从 YDocManager 移除该客户端
        if (ws._clientId) {
          ydocManager.removeClient(sessionId, ws._clientId);
        }

        // 记录用户离开活动
        activityLog.log(sessionId, 'user_leave', {
          actor: ws._username || 'anonymous',
          message: `left the session`
        });

        const clients = sessionClients.get(sessionId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) sessionClients.delete(sessionId);
        }
        console.log('[WS] client disconnected, session=' + sessionId + ' remaining=' + (clients ? clients.size : 0));
      }
      // 不断开进程：让正在运行的任务继续，重连后可接收后续输出
    });
  };
}
