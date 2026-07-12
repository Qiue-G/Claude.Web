/**
 * 工具循环模块 — 多轮 Tool Use 循环：模型请求 → 执行 → 回送结果 → 继续
 */
import { runHooks } from '../../runtime/hooksRunner.js';

// 流式超时常量
const STREAM_IDLE_TIMEOUT = 120000;   // 2 分钟无数据则超时
const STREAM_TOTAL_TIMEOUT = 180000;  // 3 分钟总体超时
const MAX_TOOL_LOOPS = 10;

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
    const headings = r.metadata?.headings?.length > 0 ? ` [${r.metadata.headings.join(' > ')}]` : '';
    const filename = r.metadata?.filename ? ` (来源: ${r.metadata.filename})` : '';
    const score = r.score !== undefined ? ` [相关性: ${((r.score / maxScore) * 100).toFixed(0)}%]` : '';
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
 * 运行 Tool Use 循环
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

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      releaseProcessSlot();
      sessionProcesses.delete(sessionId);
      wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));
      const proxy = sessionProxies.get(sessionId);
      if (proxy) { try { proxy.kill(); } catch (_) {} sessionProxies.delete(sessionId); }
      console.error(`[MODEL API] HTTP ${response.status}: ${errorText.substring(0, 200)}`);

      let userMessage = `Model API error: HTTP ${response.status}. ${errorText.substring(0, 200)}`;
      try {
        const errJson = JSON.parse(errorText);
        if (errJson.error) {
          const e = errJson.error;
          if (e.zh_message) {
            userMessage = `模型请求失败 (${e.zh_message})`;
            if (e.unavailable_models && e.unavailable_models.length > 0) userMessage += `。以下模型不可用: ${e.unavailable_models.join(', ')}`;
            if (e.models_tried && e.models_tried.length > 0) userMessage += `。已尝试: ${e.models_tried.join(', ')}`;
            if (e.code === 'endpoint_not_found') userMessage += '。请在"管理模型"中更新为当前可用的模型 ID';
          }
        }
      } catch { /* use raw */ }
      broadcastToSession(sessionId, { type: 'error', message: userMessage });
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
      streamTimeout = setTimeout(() => {}, STREAM_IDLE_TIMEOUT);
      if (streamTimeout?.unref) streamTimeout.unref();
    }
    resetStreamTimeout();

    totalTimeout = setTimeout(() => {
      if (streamTimeout) { clearTimeout(streamTimeout); streamTimeout = null; }
    }, STREAM_TOTAL_TIMEOUT);
    if (totalTimeout?.unref) totalTimeout.unref();

    while (true) {
      const raceResult = await Promise.race([
        reader.read(),
        new Promise(resolve => {
          const check = () => { if (streamTimeout === null) resolve({ timeout: true }); else setTimeout(check, 100); };
          setTimeout(check, 100);
        })
      ]);
      if (raceResult?.timeout) break;
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
        if (dataStr === '[DONE]') { broadcastToSession(sessionId, { type: 'output', data: '\n' }); continue; }
        try {
          const chunk = JSON.parse(dataStr);
          if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
            roundToolBlocks.push({ id: chunk.content_block.id, name: chunk.content_block.name, input: chunk.content_block.input || {}, index: chunk.index });
          } else if (chunk.type === 'content_block_delta') {
            if (chunk.delta?.text) { roundText += chunk.delta.text; assistantBuffer += chunk.delta.text; broadcastToSession(sessionId, { type: 'output', data: chunk.delta.text }); }
            else if (chunk.delta?.type === 'input_json_delta' && chunk.delta.partial_json) {
              const tb = roundToolBlocks.find(b => b.index === chunk.index);
              if (tb) { tb._rawJson = (tb._rawJson || '') + chunk.delta.partial_json; try { Object.assign(tb.input, JSON.parse(tb._rawJson)); } catch {} }
            }
          } else if (chunk.type === 'message_delta') { finalStopReason = chunk.delta?.stop_reason; }
        } catch (e) {}
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
    if (roundText) assistantContent.push({ type: 'text', text: roundText });
    for (const tb of roundToolBlocks) {
      if (!tb.input || typeof tb.input !== 'object' || Object.keys(tb.input).length === 0) continue;
      assistantContent.push({ type: 'tool_use', id: tb.id, name: tb.name, input: tb.input });
    }
    if (assistantContent.length > 0) toolUseMessages.push({ role: 'assistant', content: assistantContent });

    const validToolBlocks = roundToolBlocks.filter(tb => tb.input && typeof tb.input === 'object' && Object.keys(tb.input).length > 0);
    if (validToolBlocks.length > 0) {
      for (const tb of validToolBlocks) {
        broadcastToSession(sessionId, { type: 'tool_use', toolName: tb.name, toolInput: tb.input });
        let toolResult;
        try {
          toolResult = await executeToolUseBlockFn(tb, session, null);
          broadcastToSession(sessionId, { type: 'tool_result', toolName: tb.name, toolId: tb.id, result: String(toolResult) });
        } catch (err) {
          toolResult = `Error: ${err.message}`;
          broadcastToSession(sessionId, { type: 'tool_error', toolName: tb.name, toolId: tb.id, error: err.message });
        }
        toolUseMessages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tb.id, content: String(toolResult) }] });
      }
      continue;
    }
    break;
  }
  return { assistantBuffer, finalStopReason };
}
