import { extractPythonBlocks, executePython } from '../tools/codeInterpreter.js';
import { searchWeb } from '../tools/webSearch.js';
import { analyzeFilesFromPromptContext, stripFileBlocksFromPrompt } from '../tools/fileAnalysis.js';
import { buildPrompt } from '../runtime/promptBuilder.js';
import { getToolInstructions, isBuiltinTool, isMcpTool, parseMcpToolId } from '../tools/registry.js';

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

// 等待用户审批的工具请求（用 approvalId 索引）
const pendingApprovals = new Map();

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
  return function handleConnection(ws, req) {
    const {
      getSession, sessions, sessionProcesses, sessionProxies, sessionClients, wsProcCount,
      broadcastToSession, spawnCli, maskSensitive, stripAnsi,
      checkRateLimit, ALLOWED_ORIGINS, RATE_WINDOW, RATE_MAX_INPUT,
      messageStore, mcpManager, rag
    } = deps;

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

          // message.data 可能是字符串或对象 { text, files, images, tools }
          const originalPrompt = typeof message.data === 'string' ? message.data : message.data.text;
          let prompt = originalPrompt;
          const tools = (typeof message.data === 'object' ? message.data.tools : null) || [];
          const toolResults = [];
          let userMessageForPrompt = originalPrompt;

          // 保存用户消息
          if (messageStore && originalPrompt && originalPrompt.trim()) {
            await messageStore.saveMessage(sessionId, { role: 'user', content: originalPrompt });
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
                const collection = sessionId || 'default';
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
                  const result = await mcpManager.callTool(parsed.serverName, parsed.toolName, { query: originalPrompt });
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
          if (mcpManager && mcpManager.isConnected()) {
            const mcpTools = await mcpManager.listTools();
            for (const mcpTool of mcpTools) {
              if (approvedTools.includes(mcpTool.id)) {
                toolInstructions += '\n' + mcpTool.instruction;
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
          const proc = await spawnCli(session, prompt);
          sessionProcesses.set(sessionId, proc);

          // ===== 代码解释器：缓冲完整输出，关闭时检测 Python 代码块 =====
          let codeInterpreterBuffer = '';
          const hasCodeInterpreter = tools.includes('code_interpreter');
          // 累积 AI 输出，关闭时保存完整消息
          let assistantBuffer = '';

          proc.stdout.on('data', (chunk) => {
            let clean = stripAnsi(chunk.toString());
            clean = maskSensitive(clean, session.apiKey);
            if (clean.trim()) {
              assistantBuffer += clean;
              if (hasCodeInterpreter) codeInterpreterBuffer += clean;
              const MAX_WS_MSG = 1024 * 1024;
              const data = clean.length > MAX_WS_MSG ? clean.substring(0, MAX_WS_MSG) + '\n[output truncated]' : clean;
              broadcastToSession(sessionId, { type: 'output', data });
            }
          });

          proc.stderr.on('data', (chunk) => {
            let errStr = chunk.toString();
            errStr = maskSensitive(errStr, session.apiKey);
            assistantBuffer += errStr;
            if (hasCodeInterpreter) codeInterpreterBuffer += errStr;
            console.error('[STDERR] ' + maskSensitive(errStr.substring(0, 200), session.apiKey));
            const MAX_WS_ERR = 1024 * 1024;
            const data = errStr.length > MAX_WS_ERR ? errStr.substring(0, MAX_WS_ERR) + '\n[output truncated]' : errStr;
            broadcastToSession(sessionId, { type: 'stderr', data });
          });

          proc.on('close', async (code) => {
            console.log('[DONE] exit code ' + code);
            sessionProcesses.delete(sessionId);
            wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));

            // Kill proxy too
            const proxy = sessionProxies.get(sessionId);
            if (proxy) { proxy.kill(); sessionProxies.delete(sessionId); }

            // ===== 代码解释器：执行 Python 代码块 =====
            if (hasCodeInterpreter && codeInterpreterBuffer.trim()) {
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

            broadcastToSession(sessionId, { type: 'exit', code });
            broadcastToSession(sessionId, { type: 'done' });

            // 保存助理消息
            if (messageStore && assistantBuffer.trim()) {
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
        }

      } catch (error) {
        console.error('WebSocket error:', error);
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: error.message || 'Internal server error' }));
        }
        // 清理进程计数
        if (sessionId && wsProcCount) {
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
