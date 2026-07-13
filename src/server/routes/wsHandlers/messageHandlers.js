/**
 * WebSocket 消息处理器 — 入口模块
 * 核心流程: handleInputMessage 编排 prompt 构建 + 工具调用 + 输出
 * 子模块: fileSnapshot / toolExecution / toolLoop
 */
import { extractPythonBlocks, executePython } from '../../tools/codeInterpreter.js';
import { searchWeb } from '../../tools/webSearch.js';
import { analyzeFilesFromPromptContext, stripFileBlocksFromPrompt } from '../../tools/fileAnalysis.js';
import { buildPrompt } from '../../runtime/promptBuilder.js';
import { getToolInstructions } from '../../tools/registry.js';
import { getFileToolInstructions, extractAndExecuteFileTools } from '../../tools/fileTools.js';
import { getFreeCodeToolInstructions, extractAndExecuteFreeCodeTools } from '../../tools/freeCodeTools.js';
import { runHooks } from '../../runtime/hooksRunner.js';
import { runFilters } from '../../runtime/filterPipeline.js';

// 重导出子模块（保持向后兼容 wsHandler.js 的 import）
export { takeFileSnapshot, detectChangedFiles } from './fileSnapshot.js';
export { executeToolUseBlock } from './toolExecution.js';
export { runToolLoop, formatRagResults, applyPreToolUseHook, getRagSearchCollection } from './toolLoop.js';

const MAX_INPUT_LENGTH = 100000;

/**
 * 处理 input 消息（核心消息处理流程）
 * 包含：速率限制、工具审批、prompt 构建、模型调用、工具循环、输出处理
 */
export async function handleInputMessage(ws, message, sessionId, session, deps) {
  const {
    getSession, sessionProcesses, sessionProxies, wsProcCount,
    broadcastToSession, callModelWithMessages, maskSensitive, stripAnsi,
    checkRateLimit, RATE_WINDOW, RATE_MAX_INPUT,
    messageStore, mcpManager, rag, agentConfig, db,
    filtersConfig, filterPipeline, pipelines, pluginsConfig, activityLog,
    pendingApprovals, APPROVAL_TIMEOUT, MAX_HISTORY_CHARS,
    processSeqIdRef
  } = deps;

  const { enableCompaction, maxHistoryChars } = deps;
  const maxHistory = MAX_HISTORY_CHARS || maxHistoryChars || 8000;

  const data = message.data;
  if (!data || (typeof data === 'string' && !data.trim())) {
    ws.send(JSON.stringify({ type: 'error', message: 'Empty message' }));
    return { incremented: false, assistantBuffer: '' };
  }

  // Token 校验（token 在 message 顶层，不在 data 内）
  if (message.token && message.token !== session.token) {
    ws.send(JSON.stringify({ type: 'error', message: 'Token mismatch or invalid session' }));
    wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));
    return { incremented: false, assistantBuffer: '' };
  }

  // 速率限制
  if (!checkRateLimit('input:' + sessionId, RATE_MAX_INPUT, RATE_WINDOW)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Too many requests. Please wait before sending another message.' }));
    wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));
    return { incremented: false, assistantBuffer: '' };
  }

  // 输入长度限制
  const rawInput = typeof data === 'string' ? data : (data.text || '');
  if (rawInput.length > MAX_INPUT_LENGTH) {
    ws.send(JSON.stringify({ type: 'error', message: 'Message too long (max 100K characters)' }));
    return { incremented: false, assistantBuffer: '' };
  }

  let userMsg = rawInput;
  let fileAnalysisResult = null;
  let toolResults = [];

  // 保存用户消息
  if (messageStore) {
    await messageStore.saveMessage(sessionId, {
      role: 'user',
      content: rawInput,
      sessionId
    });
  }

  // 文件分析
  const fileCount = (data.files || []).length;
  if (fileCount > 0) {
    broadcastToSession(sessionId, { type: 'output', data: `[文件分析] 正在分析 ${fileCount} 个文件...\n` });
    fileAnalysisResult = await analyzeFilesFromPromptContext(rawInput, data.files || []);
    if (fileAnalysisResult.analysis && fileAnalysisResult.analysis.trim()) {
      toolResults.push({ tool: 'file_analysis', ok: true, content: fileAnalysisResult.analysis });
    }
    userMsg = stripFileBlocksFromPrompt(rawInput);
  }

  // RAG 搜索（@kb 前缀 或 tools 包含 rag_search）
  const toolsList = Array.isArray(data.tools) ? data.tools : [];
  const shouldRagSearch = rawInput.includes('@kb') || toolsList.includes('rag_search');
  if (rag && shouldRagSearch) {
    try {
      const { getRagSearchCollection } = await import('./toolLoop.js');
      const collection = getRagSearchCollection(session);
      const ragResults = await rag.search(collection, rawInput.replace('@kb', '').trim());
      if (ragResults.length > 0) {
        const { formatRagResults } = await import('./toolLoop.js');
        const ragText = formatRagResults(ragResults, rawInput);
        toolResults.push({ tool: 'rag_search', ok: true, content: ragText });
        broadcastToSession(sessionId, { type: 'output', data: `[知识库] 找到 ${ragResults.length} 条相关结果\n` });
      }
    } catch (e) {
      console.error('[RAG] search error:', e.message);
    }
  }

  // 工具审批处理 — 按策略分流: auto 自动批准 / prompt 弹窗 / deny 拒绝
  let approvedTools = [];
  const toolPolicies = (agentConfig && agentConfig.toolPolicies) || {};
  const defaultPolicy = toolPolicies.default || 'prompt';

  // Build actual tool list from data.tools (user-facing tool IDs)
  const requestedTools = (Array.isArray(data.tools) ? data.tools : [])
    .filter(t => typeof t === 'string' && t.length > 0 && t.length < 64);

  if (requestedTools.length > 0 && pendingApprovals) {
    // Separate tools by policy
    const autoTools = [];
    const promptTools = [];
    for (const toolId of requestedTools) {
      const policy = toolPolicies[toolId] || defaultPolicy;
      if (policy === 'deny') continue;      // silently dropped
      if (policy === 'auto') autoTools.push(toolId);
      else promptTools.push(toolId);
    }

    // Auto-approve tools immediately
    approvedTools.push(...autoTools);

    // Only prompt for tools that need confirmation
    if (promptTools.length > 0) {
      const approvalId = `${sessionId}_${Date.now()}`;
      const approvalPromise = new Promise(resolve => {
        const timeout = setTimeout(() => resolve([]), APPROVAL_TIMEOUT);
        pendingApprovals.set(approvalId, {
          resolve: (tools) => { clearTimeout(timeout); resolve(tools); },
          tools: promptTools,
          _timeout: timeout
        });
      });
      broadcastToSession(sessionId, {
        type: 'tool_approval_request',
        approvalId,
        tools: promptTools,
        autoApproved: autoTools
      });
      const userApproved = await approvalPromise;
      pendingApprovals.delete(approvalId);
      approvedTools.push(...userApproved);
    }
  }

  // 钩子处理
  const processedMsg = runHooks('onUserPrompt', { prompt: userMsg }, pluginsConfig || {});
  userMsg = processedMsg.prompt || userMsg;

  // 构建系统提示词 + 工具指令
  const toolInstructions = [
    getFileToolInstructions(),
    getFreeCodeToolInstructions()
  ].filter(Boolean).join('\n');

  const promptResult = buildPrompt({
    toolInstructions,
    activeToolIds: approvedTools || [],
    toolResults,
    userMessage: userMsg,
    history: messageStore ? (await messageStore.loadMessages(sessionId)).slice(0, -1) : [],
    enableCompaction: true,
    maxHistoryChars: maxHistory,
    enableTools: true,
  });

  const systemPrompt = promptResult.systemPrompt;
  const toolsForModel = promptResult.tools;

  // 运行工具循环
  const { runToolLoop } = await import('./toolLoop.js');
  const { executeToolUseBlock } = await import('./toolExecution.js');

  const toolResult = await runToolLoop({
    session, sessionId, userMsg, systemPrompt, toolsForModel,
    callModelWithMessages, broadcastToSession, sessionProcesses,
    sessionProxies, wsProcCount,
    executeToolUseBlockFn: executeToolUseBlock,
    processSeqIdRef
  });

  // 过滤管道
  if (filterPipeline && filterPipeline.length > 0) {
    toolResult.assistantBuffer = runFilters(toolResult.assistantBuffer, filterPipeline, filtersConfig || {});
  }

  // 保存助手消息
  if (messageStore && toolResult.assistantBuffer) {
    await messageStore.saveMessage(sessionId, {
      role: 'assistant',
      content: toolResult.assistantBuffer,
      sessionId
    });
  }

  return toolResult;
}
