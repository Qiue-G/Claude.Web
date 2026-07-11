/**
 * WebSocket 消息处理器模块
 * 负责处理 input 消息、工具循环、文件快照等核心逻辑
 */

import { extractPythonBlocks, executePython } from '../../tools/codeInterpreter.js';
import { searchWeb } from '../../tools/webSearch.js';
import { analyzeFilesFromPromptContext, stripFileBlocksFromPrompt } from '../../tools/fileAnalysis.js';
import { buildPrompt } from '../../runtime/promptBuilder.js';
import { getToolInstructions, isMcpTool, parseMcpToolId } from '../../tools/registry.js';
import { getFileToolInstructions, extractAndExecuteFileTools } from '../../tools/fileTools.js';
import { getFreeCodeToolInstructions, extractAndExecuteFreeCodeTools } from '../../tools/freeCodeTools.js';
import { bridgeWriteFile, bridgeReadFile, bridgeEditFile, bridgeDeleteFile, bridgeRenameFile, bridgeListFiles } from '../../tools/freeCodeBridge.js';
import { runHooks } from '../../runtime/hooksRunner.js';
import { runFilters } from '../../runtime/filterPipeline.js';
import { executeGlob, executeGrep, executeTodoWrite } from '../../tools/freeCodeTools.js';
import fs from 'fs/promises';
import path from 'path';

const MAX_INPUT_LENGTH = 100000;  // 10 万字符
const MAX_TOOL_LOOPS = 10;
const STREAM_IDLE_TIMEOUT = 120000;   // 2 分钟无数据则超时
const STREAM_TOTAL_TIMEOUT = 180000;  // 3 分钟总体超时

/**
 * 将 RAG 搜索结果格式化为可读文本
 */
export function formatRagResults(results, query) {
  if (!results || results.length === 0) {
    return `知识库搜索 "${query}" 未找到相关结果。`;
  }
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

/**
 *  Take a snapshot of all file hashes in a directory
 *  Returns: Map<filePath, { hash: string, content: string }>
 */
export async function takeFileSnapshot(dirPath) {
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
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
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
export async function detectChangedFiles(session, preExecSnapshot, db) {
  const results = [];
  const currentSnapshot = await takeFileSnapshot(session.dir);

  for (const [filePath, preData] of preExecSnapshot) {
    const currentData = currentSnapshot.get(filePath);
    if (!currentData) continue;

    if (preData.hash !== currentData.hash) {
      const oldContent = preData.content;
      const newContent = currentData.content;

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

        const newHash = createHash('sha256').update(newContent).digest('hex');
        const newId = randomUUID();
        db.run(
          `INSERT INTO file_versions (id, sessionId, filePath, content, hash, size, createdAt, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId, session.id, filePath, newContent, newHash, Buffer.byteLength(newContent, 'utf-8'), Date.now(), 'post-exec']
        );

        const { diffLines } = await import('diff');
        const changes = diffLines(oldContent, newContent);

        const added = changes.filter(c => c.added).reduce((s, c) => s + (c.count || 0), 0);
        const removed = changes.filter(c => c.removed).reduce((s, c) => s + (c.count || 0), 0);

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
export async function executeToolUseBlock(tb, session, mcpManager) {
  const { name, input } = tb;

  function validateParam(val, label) {
    if (!val || (typeof val === 'string' && !val.trim())) {
      throw new Error(`${name}: ${label} 参数缺失`);
    }
    return val.trim();
  }

  switch (name) {
    case 'write_file': {
      const p = validateParam(input.file_path || input.path, 'file_path');
      const content = input.content !== undefined ? String(input.content) : '';
      return await bridgeWriteFile(p, content, session.dir);
    }
    case 'read_file':
    case 'read': {
      const p = validateParam(input.file_path || input.path, 'file_path');
      return await bridgeReadFile(p, session.dir);
    }
    case 'edit_file':
    case 'edit': {
      const p = validateParam(input.file_path || input.path, 'file_path');
      const oldStr = validateParam(input.old_string || input.searchStr, 'old_string/searchStr');
      const newStr = input.new_string || input.replaceStr || '';
      return await bridgeEditFile(p, oldStr, newStr, session.dir);
    }
    case 'delete_file': {
      const p = validateParam(input.file_path || input.path, 'file_path');
      return await bridgeDeleteFile(p, session.dir);
    }
    case 'rename_file': {
      const oldPath = validateParam(input.file_path || input.path, 'file_path');
      const newPath = validateParam(input.new_path || input.newPath, 'new_path/newPath');
      return await bridgeRenameFile(oldPath, newPath, session.dir);
    }
    case 'list_files':
      return await bridgeListFiles(input.dir || input.path || '.', session.dir);

    case 'glob':
      return await executeGlob(input, session);
    case 'grep':
      return await executeGrep(input, session);
    case 'todo_write':
      return await executeTodoWrite(input, session);

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

/**
 * 运行 Tool Use 循环
 * 支持多轮：模型请求 tool_use → 执行 → 发送结果 → 模型继续
 */
export async function runToolLoop({
  session, sessionId, userMsg, systemPrompt, toolsForModel,
  callModelWithMessages, broadcastToSession, sessionProcesses,
  sessionProxies, wsProcCount, executeToolUseBlockFn, processSeqIdRef
}) {
  let assistantBuffer = '';
  let finalStopReason = null;
  const toolUseMessages = [];

  for (let loopIdx = 0; loopIdx < MAX_TOOL_LOOPS; loopIdx++) {
    const messagesForModel = loopIdx === 0
      ? [{ role: 'user', content: [{ type: 'text', text: userMsg }] }]
      : toolUseMessages;
    const { response, releaseProcessSlot } = await callModelWithMessages(session, systemPrompt, messagesForModel, toolsForModel);

    // 检查 HTTP 响应状态，避免静默失败
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      releaseProcessSlot();
      sessionProcesses.delete(sessionId);
      wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));
      const proxy = sessionProxies.get(sessionId);
      if (proxy) { try { proxy.kill(); } catch (_) {} sessionProxies.delete(sessionId); }
      console.error(`[MODEL API] HTTP ${response.status}: ${errorText.substring(0, 200)}`);
      broadcastToSession(sessionId, { type: 'error', message: `Model API error: HTTP ${response.status}. ${errorText.substring(0, 200)}` });
      return { incremented: false, assistantBuffer: '' };
    }

    const requestId = ++processSeqIdRef.value;
    sessionProcesses.set(sessionId, { _procSeq: requestId });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let roundText = '';
    let roundToolBlocks = [];
    let streamTimeout = null;
    let totalTimeout = null;

    function resetStreamTimeout() {
      if (streamTimeout) clearTimeout(streamTimeout);
      streamTimeout = setTimeout(() => {
        console.error(`[wsHandler] Stream idle timeout for session ${sessionId} after ${STREAM_IDLE_TIMEOUT}ms`);
        streamTimeout = null;
      }, STREAM_IDLE_TIMEOUT);
      if (streamTimeout && streamTimeout.unref) streamTimeout.unref();
    }
    resetStreamTimeout();

    totalTimeout = setTimeout(() => {
      console.error(`[wsHandler] Stream total timeout for session ${sessionId} after ${STREAM_TOTAL_TIMEOUT}ms`);
      if (streamTimeout) { clearTimeout(streamTimeout); streamTimeout = null; }
    }, STREAM_TOTAL_TIMEOUT);
    if (totalTimeout && totalTimeout.unref) totalTimeout.unref();

    while (true) {
      const raceResult = await Promise.race([
        reader.read(),
        new Promise(resolve => {
          const check = () => {
            if (streamTimeout === null) resolve({ timeout: true });
            else setTimeout(check, 100);
          };
          setTimeout(check, 100);
        })
      ]);
      
      // 检查超时标志
      if (raceResult?.timeout) {
        console.error(`[wsHandler] Breaking stream due to timeout for session ${sessionId}`);
        break;
      }
      
      // 使用 race 的结果，不要再次调用 reader.read()
      const { done, value } = raceResult;
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
              const tb = roundToolBlocks.find(b => b.index === chunk.index);
              if (tb) {
                tb._rawJson = (tb._rawJson || '') + chunk.delta.partial_json;
                try {
                  const parsed = JSON.parse(tb._rawJson);
                  Object.assign(tb.input, parsed);
                } catch {
                  // 不完整的 JSON 流片，继续累积
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

    if (streamTimeout) { clearTimeout(streamTimeout); streamTimeout = null; }
    if (totalTimeout) { clearTimeout(totalTimeout); totalTimeout = null; }

    releaseProcessSlot();
    sessionProcesses.delete(sessionId);
    wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));

    const proxy = sessionProxies.get(sessionId);
    if (proxy) { proxy.kill(); sessionProxies.delete(sessionId); }

    const assistantContent = [];
    if (roundText) {
      assistantContent.push({ type: 'text', text: roundText });
    }
    for (const tb of roundToolBlocks) {
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

    if (assistantContent.length > 0) {
      toolUseMessages.push({ role: 'assistant', content: assistantContent });
    }

    const validToolBlocks = roundToolBlocks.filter(tb => tb.input && typeof tb.input === 'object' && Object.keys(tb.input).length > 0);
    if (validToolBlocks.length > 0) {
      for (const tb of validToolBlocks) {
        // 发送 tool_use 事件（前端可单独渲染，不混入文本流）
        broadcastToSession(sessionId, {
          type: 'tool_use',
          toolName: tb.name,
          toolInput: tb.input
        });

        let toolResult;
        try {
          toolResult = await executeToolUseBlockFn(tb, session, null);
          broadcastToSession(sessionId, {
            type: 'tool_result',
            toolName: tb.name,
            result: String(toolResult)
          });
        } catch (err) {
          toolResult = `Error: ${err.message}`;
          broadcastToSession(sessionId, {
            type: 'tool_error',
            toolName: tb.name,
            error: err.message
          });
        }

        toolUseMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: tb.id,
            content: String(toolResult)
          }]
        });
      }
      continue;
    }

    break;
  }

  return { assistantBuffer, finalStopReason };
}

/**
 * 处理 input 消息（核心消息处理流程）
 * 包含：速率限制、工具审批、prompt 构建、模型调用、工具循环、输出处理
 * 
 * @returns {{ incremented: boolean, assistantBuffer: string }}
 */
export async function handleInputMessage(ws, message, sessionId, session, deps) {
  const {
    getSession, sessionProcesses, sessionProxies, wsProcCount,
    broadcastToSession, callModelWithMessages, maskSensitive, stripAnsi,
    checkRateLimit, RATE_WINDOW, RATE_MAX_INPUT,
    messageStore, mcpManager, rag, agentConfig, db,
    filtersConfig, filterPipeline, pipelines, pluginsConfig, activityLog,
    pendingApprovals, APPROVAL_TIMEOUT, MAX_HISTORY_CHARS
  } = deps;

  // Rate limit
  if (!checkRateLimit('input:' + sessionId, RATE_MAX_INPUT, RATE_WINDOW)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Too many requests. Please slow down.' }));
    return { incremented: false, assistantBuffer: '' };
  }

  // Session token re-validation
  if (message.token && session.token !== message.token) {
    ws.send(JSON.stringify({ type: 'error', message: 'Session token mismatch' }));
    return { incremented: false, assistantBuffer: '' };
  }

  // Max 2 concurrent processes per session
  const currentCount = wsProcCount.get(sessionId) || 0;
  if (currentCount >= 2) {
    ws.send(JSON.stringify({ type: 'error', message: 'Already processing. Wait for completion.' }));
    return { incremented: false, assistantBuffer: '' };
  }

  const oldProc = sessionProcesses.get(sessionId);
  if (oldProc) oldProc.kill();
  const oldProxy = sessionProxies.get(sessionId);
  if (oldProxy) { oldProxy.kill(); sessionProxies.delete(sessionId); }

  const originalPrompt = typeof message.data === 'string' ? message.data : message.data.text;

  if (originalPrompt && originalPrompt.length > MAX_INPUT_LENGTH) {
    ws.send(JSON.stringify({ type: 'error', message: `输入超出长度限制 (${MAX_INPUT_LENGTH} 字符)` }));
    return { incremented: false, assistantBuffer: '' };
  }
  let prompt = originalPrompt;
  const tools = (typeof message.data === 'object' ? message.data.tools : null) || [];
  const toolResults = [];
  let userMessageForPrompt = originalPrompt;

  // 保存用户消息
  if (messageStore && originalPrompt && originalPrompt.trim()) {
    await messageStore.saveMessage(sessionId, { role: 'user', content: originalPrompt });
    activityLog?.log(sessionId, 'message_send', {
      actor: ws._username || 'anonymous',
      message: originalPrompt.slice(0, 100) + (originalPrompt.length > 100 ? '...' : '')
    });
  }

  // ===== 工具审批流程 =====
  let approvedTools = tools;
  let approvalWasTriggered = false;
  if (tools.length > 0) {
    approvalWasTriggered = true;
    const approvalId = sessionId + '_' + Date.now();
    const approvalPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingApprovals.delete(approvalId);
        resolve([]);
      }, APPROVAL_TIMEOUT);

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
  if (approvalWasTriggered) {
    broadcastToSession(sessionId, { type: 'tool_approval_complete' });
  }

  // Build prompt
  let toolInstructions = getToolInstructions(approvedTools || []);
  toolInstructions += '\n' + 'You can execute Python code for calculations and data analysis. When useful, provide executable Python code in a fenced python code block.';
  toolInstructions += '\n\n' + getFileToolInstructions();
  toolInstructions += '\n\n' + getFreeCodeToolInstructions();

  if (mcpManager && mcpManager.isConnected()) {
    const mcpTools = await mcpManager.listTools();
    for (const mcpTool of mcpTools) {
      if (approvedTools.includes(mcpTool.id)) {
        toolInstructions += '\n' + mcpTool.instruction;
      }
    }
  }

  // Agent 钩子
  const hooksCtx = runHooks('onUserPrompt', { prompt: userMessageForPrompt }, pluginsConfig);
  userMessageForPrompt = hooksCtx.prompt;

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

  // Pipelines
  if (pipelines.length > 0) {
    const pipeResult = await runPipelines('input', userMessageForPrompt, {
      session,
      context: { rag, filterOptions: filtersConfig }
    }, pipelines);
    if (pipeResult.content !== userMessageForPrompt) {
      userMessageForPrompt = pipeResult.content;
    }
  }

  // 输入过滤器
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
    maxHistoryChars: MAX_HISTORY_CHARS,
    enableTools: true,
  });

  const systemPrompt = promptResult.systemPrompt;
  const userMsg = promptResult.userMessage;
  const toolsForModel = promptResult.tools;

  console.log('[INPUT] systemPrompt length: ' + (systemPrompt ? systemPrompt.length : 0) + ', userMsg: "' + (userMsg || '').substring(0, 80) + '", tools: [' + (toolsForModel || []).map(t => t.name).join(',') + ']');

  const preExecSnapshot = await takeFileSnapshot(session.dir);

  // ===== Tool Use 循环 =====
  const { assistantBuffer: loopBuffer } = await runToolLoop({
    session, sessionId, userMsg, systemPrompt, toolsForModel,
    callModelWithMessages, broadcastToSession, sessionProcesses,
    sessionProxies, wsProcCount,
    executeToolUseBlockFn: executeToolUseBlock,
    processSeqIdRef: deps.processSeqIdRef
  });

  // ===== 降级：代码围栏提取 =====
  let assistantBuffer = loopBuffer;
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

    const fileToolResults = await extractAndExecuteFileTools(assistantBuffer, session);
    for (const r of fileToolResults) {
      if (r.ok) {
        broadcastToSession(sessionId, { type: 'output', data: `\n[${r.tool}] ${r.result}\n` });
      } else {
        broadcastToSession(sessionId, { type: 'output', data: `\n[${r.tool} 失败] ${r.error}\n` });
      }
    }

    const freeCodeResults = await extractAndExecuteFreeCodeTools(assistantBuffer, session);
    for (const r of freeCodeResults) {
      if (r.ok) {
        broadcastToSession(sessionId, { type: 'output', data: `\n[${r.tool}] ${r.result}\n` });
      } else {
        broadcastToSession(sessionId, { type: 'output', data: `\n[${r.tool} 失败] ${r.error}\n` });
      }
    }
  }

  // 输出管道
  if (pipelines.length > 0 && assistantBuffer.trim()) {
    const pipeResult = await runPipelines('output', assistantBuffer, {
      session,
      context: { filterOptions: filtersConfig }
    }, pipelines);
    if (pipeResult.content !== assistantBuffer) {
      assistantBuffer = pipeResult.content;
    }
  }

  // 输出过滤器
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

  return { incremented: true, assistantBuffer };
}
