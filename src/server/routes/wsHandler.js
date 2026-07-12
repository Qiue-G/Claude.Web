import { exec } from 'child_process';
import { buildFilterList } from '../runtime/filters/index.js';
import { loadPipelines, runPipelines } from '../pipelines/index.js';
import { YDocManager } from '../collab/ydocManager.js';
import { ActivityLog } from '../collab/activityLog.js';
import { handleVersionList, handleVersionRestore, handleVersionDiff } from './wsHandlers/versionHandlers.js';
import { handleYjsSync, handleYjsUpdate, handleCursorUpdate, handlePresence } from './wsHandlers/collabHandlers.js';
import {
  handleInputMessage,
  takeFileSnapshot,
  detectChangedFiles,
  executeToolUseBlock
} from './wsHandlers/messageHandlers.js';
import * as Y from 'yjs';

// 超时和缓冲区常量
const BASH_COMMAND_TIMEOUT = 30000;  // 30 秒
const BASH_MAX_BUFFER = 1024 * 1024;  // 1MB
const APPROVAL_TIMEOUT = 120000;  // 2 分钟
// 历史消息最大字符数（可通过环境变量调整，默认 64000 约 16K tokens）
const MAX_HISTORY_CHARS = parseInt(process.env.MAX_HISTORY_CHARS || '64000', 10);
const MAX_COMMAND_LENGTH = 4096;  // 命令最大字符数

// 危险模式：拒绝包含以下模式的命令
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bdd\s+if=/,
  /\bmkfs\./,
  /:\s*\(\)\s*\{/,          // fork bomb
  />\s*\/dev\/sda/,
  /\bchmod\s+(-R\s+)?777\s+\//,
  /\bcurl.*\|\s*(ba)?sh/,   // curl pipe shell
  /\bwget.*\|\s*(ba)?sh/,
  /\beval\b/,
];

// 命令中需要过滤的危险元字符/语法
const DANGEROUS_SHELL_PATTERNS = [
  /`[^`]+`/,                // backtick command substitution
  /\$\([^)]+\)/,            // $() command substitution
  /\$\\{/,                  // ${} dangerous expansion
];

// 等待用户审批的工具请求（用 approvalId 索引）
const pendingApprovals = new Map();

/**
 * Validate a bash command for dangerous patterns.
 * @param {string} command
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateBashCommand(command) {
  if (typeof command !== 'string') return { valid: false, reason: 'Command must be a string' };
  if (command.length > MAX_COMMAND_LENGTH) return { valid: false, reason: 'Command too long' };
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(command)) return { valid: false, reason: 'Command contains dangerous pattern: ' + pattern.source };
  }
  for (const pattern of DANGEROUS_SHELL_PATTERNS) {
    if (pattern.test(command)) return { valid: false, reason: 'Command contains shell injection pattern: ' + pattern.source };
  }
  return { valid: true };
}

// 进程序号生成器（用于检测过时进程的 close 事件）
// 使用包装对象确保 messageHandlers 和 wsHandler 共享同一引用
const processSeqIdRef = { value: 0 };

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
          // validate command safety
          const validation = validateBashCommand(command);
          if (!validation.valid) {
            ws.send(JSON.stringify({ type: 'error', message: 'Command rejected: ' + validation.reason }));
            return;
          }
          const bashSession = getSession(sessionId);
          const bashCwd = bashSession ? bashSession.dir : process.cwd();
          const preExecSnapshot = bashSession ? await takeFileSnapshot(bashSession.dir) : new Map();
          broadcastToSession(sessionId, { type: 'output', data: `\n[执行命令] $ ${command}\n` });
          exec(command, {
            cwd: bashCwd,
            timeout: BASH_COMMAND_TIMEOUT,
            maxBuffer: BASH_MAX_BUFFER
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

          // 回放断线期间缓冲的实时事件（E1: 事件溯源）
          const buffered = deps.getBufferedEvents
            ? deps.getBufferedEvents(sessionId, message.lastEventSeq || 0)
            : [];
          if (buffered.length > 0) {
            for (const event of buffered) {
              ws.send(JSON.stringify(event));
            }
            console.log('[REPLAY] sent ' + buffered.length + ' buffered events to session ' + sessionId);
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
          try {
            const session = getSession(sessionId);
            if (!session) {
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid session' }));
              return;
            }

            // 先检查并发限制，再递增计数
            const currentCount = wsProcCount.get(sessionId) || 0;
            if (currentCount >= 2) {
              ws.send(JSON.stringify({ type: 'error', message: 'Already processing. Wait for completion.' }));
              return;
            }
            wsProcCount.set(sessionId, currentCount + 1);
            isInputMessage = true;

            await handleInputMessage(ws, message, sessionId, session, {
              getSession, sessionProcesses, sessionProxies, wsProcCount,
              broadcastToSession, callModelWithMessages, maskSensitive, stripAnsi,
              checkRateLimit, RATE_WINDOW, RATE_MAX_INPUT,
              messageStore, mcpManager, rag, agentConfig, db,
              filtersConfig, filterPipeline, pipelines, pluginsConfig, activityLog,
              pendingApprovals, APPROVAL_TIMEOUT, MAX_HISTORY_CHARS,
              processSeqIdRef
            });
          } catch (inputErr) {
            console.error('[INPUT] Error:', inputErr);
            wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'error', message: inputErr.message || 'Input processing failed' }));
            }
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
          handleYjsSync(ws, message, sessionId, getSession, ydocManager, broadcastToSession, activityLog);

        } else if (message.type === 'yjs_update') {
          handleYjsUpdate(ws, message, sessionId, ydocManager);

        } else if (message.type === 'cursor_update') {
          handleCursorUpdate(ws, message, sessionId, broadcastToSession, ydocManager);

        } else if (message.type === 'presence') {
          handlePresence(ws, message, sessionId, broadcastToSession, ydocManager);

        // ===== 版本历史相关消息 (T5) =====
        } else if (message.type === 'version_list') {
          handleVersionList(ws, message, sessionId, getSession, db);

        } else if (message.type === 'version_restore') {
          handleVersionRestore(ws, message, sessionId, getSession, broadcastToSession, db);

        } else if (message.type === 'version_diff') {
          handleVersionDiff(ws, message, sessionId, getSession, db);
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
