import { extractPythonBlocks, executePython } from '../tools/codeInterpreter.js';
import { exec } from 'child_process';
import { searchWeb } from '../tools/webSearch.js';
import { analyzeFilesFromPromptContext, stripFileBlocksFromPrompt } from '../tools/fileAnalysis.js';
import { buildPrompt } from '../runtime/promptBuilder.js';
import { getToolInstructions, isBuiltinTool, isMcpTool, parseMcpToolId } from '../tools/registry.js';
import { getFileToolInstructions, extractAndExecuteFileTools, isPathInDir, executeFileTool } from '../tools/fileTools.js';
import { getFreeCodeToolInstructions, extractAndExecuteFreeCodeTools, executeGlob, executeGrep, executeTodoWrite } from '../tools/freeCodeTools.js';
import { bridgeWriteFile, bridgeReadFile, bridgeEditFile, bridgeDeleteFile, bridgeRenameFile, bridgeListFiles } from '../tools/freeCodeBridge.js';
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
 * @param {function} deps.callModelWithTools
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
    } catch (e) {
      console.warn('[FILE SNAPSHOT] Error reading directory:', e.message);
    }
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

/**
 * 执行 tool_use 块（Function Calling 模式）
 * 将模型结构化工具调用分派到对应的执行器
 */
async function executeToolUseBlock(tb, session, mcpManager) {
  const { name, input } = tb;

  // 参数预检：确保必要参数不为空
  function validateParam(val, label) {
    if (!val || (typeof val === 'string' && !val.trim())) {
      throw new Error(`${name}: ${label} 参数缺失`);
    }
    return val.trim();
  }

  switch (name) {
    // ===== File Tools（桥接：优先 free-code 编译版，回退原生） =====
    case 'write_file': {
      const path = validateParam(input.file_path || input.path, 'file_path');
      const content = input.content !== undefined ? String(input.content) : '';
      return await bridgeWriteFile(path, content, session.dir);
    }
    case 'read_file':
    case 'read': {
      const path = validateParam(input.file_path || input.path, 'file_path');
      return await bridgeReadFile(path, session.dir);
    }
    case 'edit_file':
    case 'edit': {
      const path = validateParam(input.file_path || input.path, 'file_path');
      const oldStr = validateParam(input.old_string || input.searchStr, 'old_string/searchStr');
      const newStr = input.new_string || input.replaceStr || '';
      return await bridgeEditFile(path, oldStr, newStr, session.dir);
    }
    case 'delete_file': {
       const path = validateParam(input.file_path || input.path, 'file_path');
       return await bridgeDeleteFile(path, session.dir);
     }
     case 'rename_file': {
       const oldPath = validateParam(input.file_path || input.path, 'file_path');
       const newPath = validateParam(input.new_path || input.newPath, 'new_path/newPath');
       return await bridgeRenameFile(oldPath, newPath, session.dir);
     }
     case 'list_files':
       return await bridgeListFiles(input.dir || input.path || '.', session.dir);

    // ===== Free-code 工具 =====
    case 'glob':
      return await executeGlob(input, session);
    case 'grep':
      return await executeGrep(input, session);
    case 'todo_write':
      return await executeTodoWrite(input, session);

    // ===== 内置工具 =====
    case 'code_interpreter': {
      const result = await executePython(input.code || '');
      let output = '';
      if (result.stdout) output += `输出:\n${result.stdout}`;
      if (result.stderr) output += `错误:\n${result.stderr}`;
      if (result.exitCode !== 0) output += `\n退出码: ${result.exitCode}`;
      return output || '空输出';
    }
    case 'web_search': {
      const results = await searchWeb(input.query);
      return JSON.stringify(results, null, 2);
    }

    // ===== MCP 工具 =====
    default:
      if (name.startsWith('mcp_')) {
        const parsed = parseMcpToolId(name);
        if (parsed && mcpManager) {
          return JSON.stringify(await mcpManager.callTool(parsed.serverName, parsed.toolName, input));
        }
        return 'MCP 工具不可用';
      }
      throw new Error(`未知工具: ${name}`);
  }
}

  return function handleConnection(ws, req) {
    const {
      getSession, sessions, sessionProcesses, sessionProxies, sessionClients, wsProcCount,
      broadcastToSession, spawnCli, callModelWithTools, callModelWithMessages, maskSensitive, stripAnsi,
      checkRateLimit, ALLOWED_ORIGINS, RATE_WINDOW, RATE_MAX_INPUT,
      messageStore, mcpManager, rag, agentConfig, db
    } = deps;
    const pluginsConfig = (agentConfig && agentConfig.plugins) || {};
    const filtersConfig = (agentConfig && agentConfig.filters) || {};
    const filterPipeline = buildFilterList(filtersConfig);

    // 加载外部管道脚本（非阻塞）
    let pipelines = [];
    loadPipelines().then(p => { pipelines = p; }).catch(e => {
      console.error('[WS] Failed to load pipelines:', e.message);
    });

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
                const changedFiles = (await detectChangedFiles(bashSession, preExecSnapshot, db)).filter(
                  f => !f.filePath.endsWith('.claude.json')
                );
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

          // 输入长度限制
          const MAX_INPUT_LENGTH = 100000;
          if (originalPrompt && originalPrompt.length > MAX_INPUT_LENGTH) {
            ws.send(JSON.stringify({ type: 'error', message: `输入超出长度限制 (${MAX_INPUT_LENGTH} 字符)` }));
            return;
          }
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
          // Python 代码解释器指令
          toolInstructions += '\n' + 'You can execute Python code for calculations and data analysis. When useful, provide executable Python code in a fenced python code block.';
          // 文件操作工具指令（从 fileTools.js 获取）
          toolInstructions += '\n\n' + getFileToolInstructions();
          // free-code 工具指令（从 freeCodeTools.js 获取）
          toolInstructions += '\n\n' + getFreeCodeToolInstructions();

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

          const promptResult = buildPrompt({
            toolInstructions,
            activeToolIds: approvedTools || [],
            toolResults,
            userMessage: userMessageForPrompt,
            history: messageStore ? (await messageStore.loadMessages(sessionId)).slice(0, -1) : [],
            enableCompaction: true,
            maxHistoryChars: 8000,
            enableTools: true,
          });

          const systemPrompt = promptResult.systemPrompt;
          const userMsg = promptResult.userMessage;
          const toolsForModel = promptResult.tools;

          console.log('[INPUT] systemPrompt length: ' + (systemPrompt ? systemPrompt.length : 0) + ', userMsg: "' + (userMsg || '').substring(0, 80) + '", tools: [' + (toolsForModel || []).map(t => t.name).join(',') + ']');

          wsProcCount.set(sessionId, (wsProcCount.get(sessionId) || 0) + 1);
          isInputMessage = true;
          const preExecSnapshot = await takeFileSnapshot(session.dir);

          let assistantBuffer = '';
          let finalStopReason = null;
          let toolUseBlocks = [];
          let toolUseMessages = []; // 累积的多轮消息历史

          // ===== Tool Use 循环 =====
          // 支持多轮：模型请求 tool_use → 执行 → 发送结果 → 模型继续
          // 关键修复：第一轮把用户消息放在 messages 数组里（role: 'user'），而不是嵌入 system prompt
          const MAX_TOOL_LOOPS = 10;
          for (let loopIdx = 0; loopIdx < MAX_TOOL_LOOPS; loopIdx++) {
            const messagesForModel = loopIdx === 0
              ? [{ role: 'user', content: [{ type: 'text', text: userMsg }] }]
              : toolUseMessages;
            const { response, releaseProcessSlot } = await callModelWithMessages(session, systemPrompt, messagesForModel, toolsForModel);

            const requestId = ++processSeqId;
            sessionProcesses.set(sessionId, { _procSeq: requestId });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            let roundText = '';
            let roundToolBlocks = [];
            let streamTimeout = null;
            let totalTimeout = null;
            const STREAM_IDLE_TIMEOUT = 120000; // 2分钟无数据则超时
            const STREAM_TOTAL_TIMEOUT = 180000; // 3分钟总体超时（防止代理无限重试）

            function resetStreamTimeout() {
              if (streamTimeout) clearTimeout(streamTimeout);
              streamTimeout = setTimeout(() => {
                console.error(`[wsHandler] Stream idle timeout for session ${sessionId} after ${STREAM_IDLE_TIMEOUT}ms`);
                streamTimeout = null;
              }, STREAM_IDLE_TIMEOUT);
              if (streamTimeout && streamTimeout.unref) streamTimeout.unref();
            }
            resetStreamTimeout();

            // 总体超时：不管有没有数据，到时间就断
            totalTimeout = setTimeout(() => {
              console.error(`[wsHandler] Stream total timeout for session ${sessionId} after ${STREAM_TOTAL_TIMEOUT}ms`);
              if (streamTimeout) { clearTimeout(streamTimeout); streamTimeout = null; }
            }, STREAM_TOTAL_TIMEOUT);
            if (totalTimeout && totalTimeout.unref) totalTimeout.unref();

            while (true) {
              const readPromise = reader.read();
              const raceResult = await Promise.race([
                readPromise,
                new Promise(resolve => {
                  const check = () => {
                    if (streamTimeout === null) resolve({ timeout: true });
                    else setTimeout(check, 100);
                  };
                  setTimeout(check, 100);
                })
              ]);
              if (raceResult?.timeout) {
                console.error(`[wsHandler] Breaking stream due to timeout for session ${sessionId}`);
                break;
              }
              const { done, value } = await readPromise;
              if (done) break;
              resetStreamTimeout();

              buf += decoder.decode(value, { stream: true });
              const lines = buf.split('\n');
              buf = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;

                const dataStr = trimmed.slice(6);
                if (dataStr === '[DONE]') {
                  broadcastToSession(sessionId, { type: 'output', data: '\n' });
                  continue;
                }

                try {
                  const chunk = JSON.parse(dataStr);

                  if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
                    // 模型开始请求使用工具
                    const tb = {
                      id: chunk.content_block.id,
                      name: chunk.content_block.name,
                      input: chunk.content_block.input || {},
                      index: chunk.index
                    };
                    roundToolBlocks.push(tb);
                  } else if (chunk.type === 'content_block_delta') {
                    if (chunk.delta?.text) {
                      roundText += chunk.delta.text;
                      assistantBuffer += chunk.delta.text;
                      broadcastToSession(sessionId, { type: 'output', data: chunk.delta.text });
                    } else if (chunk.delta?.type === 'input_json_delta' && chunk.delta.partial_json) {
                      // 累积 tool_use 的 JSON 参数
                      const tb = roundToolBlocks.find(b => b.index === chunk.index);
                      if (tb) {
                        try {
                          const partial = JSON.parse(chunk.delta.partial_json);
                          Object.assign(tb.input, partial);
                        } catch {
                          // 不完整的 JSON 流片，下次再合并
                        }
                      }
                    }
                  } else if (chunk.type === 'message_delta') {
                    finalStopReason = chunk.delta?.stop_reason;
                  }
                } catch (e) {
                  console.error('[STREAM PARSE ERROR]', e.message);
                }
              }
            }

            // 清理 stream 超时
            if (streamTimeout) { clearTimeout(streamTimeout); streamTimeout = null; }
            if (totalTimeout) { clearTimeout(totalTimeout); totalTimeout = null; }

            releaseProcessSlot();
            sessionProcesses.delete(sessionId);
            wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));

            // 清理 proxy（每个 loop 可能创建了新的 proxy）
            const proxy = sessionProxies.get(sessionId);
            if (proxy) { proxy.kill(); sessionProxies.delete(sessionId); }

            // 构建本轮 assistant 消息内容块
            const assistantContent = [];
            if (roundText) {
              assistantContent.push({ type: 'text', text: roundText });
            }
            for (const tb of roundToolBlocks) {
              // 跳过空参数的工具调用（deepseek-v4 有时会生成仅有工具名而无参数的 DSML 标记）
              if (!tb.input || typeof tb.input !== 'object' || Object.keys(tb.input).length === 0) {
                continue;
              }
              assistantContent.push({
                type: 'tool_use',
                id: tb.id,
                name: tb.name,
                input: tb.input
              });
            }

            // 累加到消息历史
            if (assistantContent.length > 0) {
              toolUseMessages.push({ role: 'assistant', content: assistantContent });
            }

            // 处理本轮 tool_use 请求（仅处理有参数的）
            const validToolBlocks = roundToolBlocks.filter(tb => tb.input && typeof tb.input === 'object' && Object.keys(tb.input).length > 0);
            if (validToolBlocks.length > 0) {
              for (const tb of validToolBlocks) {
                broadcastToSession(sessionId, { type: 'output', data: `\n[使用工具: ${tb.name}]\n` });

                let toolResult;
                try {
                  toolResult = await executeToolUseBlock(tb, session, mcpManager);
                  broadcastToSession(sessionId, { type: 'output', data: `\n[${tb.name}] ${toolResult}\n` });
                } catch (err) {
                  toolResult = `Error: ${err.message}`;
                  broadcastToSession(sessionId, { type: 'output', data: `\n[${tb.name} 失败] ${err.message}\n` });
                }

                // 将 tool_result 添加到消息历史
                toolUseMessages.push({
                  role: 'user',
                  content: [{
                    type: 'tool_result',
                    tool_use_id: tb.id,
                    content: String(toolResult)
                  }]
                });
              }

              // 继续下一轮循环（让模型处理 tool_result）
              continue;
            }

            // 无 tool_use，结束循环
            break;
          }

          // ===== 降级：代码围栏提取（当模型未使用 tool_use 时） =====
          if (assistantBuffer.trim()) {
            let pythonBlocks = extractPythonBlocks(assistantBuffer);
            for (let i = 0; i < pythonBlocks.length; i++) {
              broadcastToSession(sessionId, { type: 'output', data: `\n[执行 Python 代码块 ${i + 1}/${pythonBlocks.length}...]\n` });
              const result = await executePython(pythonBlocks[i]);
              let output = `\n[代码块 ${i + 1} 执行完毕]`;
              if (result.stdout) output += `\n输出:\n${result.stdout}`;
              if (result.stderr) output += `\n错误:\n${result.stderr}`;
              if (result.exitCode !== 0) output += `\n退出码: ${result.exitCode}`;
              broadcastToSession(sessionId, { type: 'output', data: output + '\n' });
            }

            // File Tools：代码围栏格式的文件操作
            const fileToolResults = await extractAndExecuteFileTools(assistantBuffer, session);
            for (const r of fileToolResults) {
              if (r.ok) {
                broadcastToSession(sessionId, { type: 'output', data: `\n[${r.tool}] ${r.result}\n` });
              } else {
                broadcastToSession(sessionId, { type: 'output', data: `\n[${r.tool} 失败] ${r.error}\n` });
              }
            }

            // free-code Tools：代码围栏格式的工具
            const freeCodeResults = await extractAndExecuteFreeCodeTools(assistantBuffer, session);
            for (const r of freeCodeResults) {
              if (r.ok) {
                broadcastToSession(sessionId, { type: 'output', data: `\n[${r.tool}] ${r.result}\n` });
              } else {
                broadcastToSession(sessionId, { type: 'output', data: `\n[${r.tool} 失败] ${r.error}\n` });
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

          broadcastToSession(sessionId, { type: 'exit', code: 0 });
          broadcastToSession(sessionId, { type: 'done' });

          const changedFiles = (await detectChangedFiles(session, preExecSnapshot, db)).filter(
            f => !f.filePath.endsWith('.claude.json')
          );
          if (changedFiles.length > 0) {
            broadcastToSession(sessionId, { type: 'file_diff', diffs: changedFiles });
          }

          if (messageStore && assistantBuffer.trim() && !outputFilterAborted) {
            await messageStore.saveMessage(sessionId, { role: 'assistant', content: assistantBuffer.trim() });
          }
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
            pending.resolve('cancelled'); // 确保等待审批的流程不会永久挂起
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
