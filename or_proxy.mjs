/**
 * or_proxy.mjs v6
 * Local proxy: Anthropic Messages API ↔ OpenAI Chat Completions (with Tool Use support)
 * Supports OpenRouter, DeepSeek, and any OpenAI-compatible API.
 * v6: Anthropic tools ↔ OpenAI functions bidirectional translation + streaming support
 */
import { createServer } from 'http';

const args = process.argv.slice(2);
const modelIdx = args.indexOf('--model');
const MODEL = modelIdx >= 0 ? args[modelIdx + 1] : 'anthropic/claude-haiku-4.5';
const baseUrlIdx = args.indexOf('--base-url');
const BASE_URL = baseUrlIdx >= 0 ? args[baseUrlIdx + 1] : 'https://openrouter.ai/api/v1';
const CHAT_URL = BASE_URL + '/chat/completions';
const PORT = parseInt(process.env.PROXY_PORT || '0', 10) || 0;
const KEY = process.env.ANTHROPIC_API_KEY || '';
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB 请求体上限

// --- Fallback / retry config ---
const fallbackIdx = args.indexOf('--fallback-model');
const FALLBACK_MODEL = fallbackIdx >= 0 ? args[fallbackIdx + 1] : null;
const MAX_RETRIES = 2;          // same-model retry count
const BASE_RETRY_DELAY = 1000;  // ms, doubles each attempt
const REQUEST_TIMEOUT = 120000; // 120s per attempt

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isRetryable(status, error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return true;
  if (error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT' || error?.code === 'ECONNREFUSED') return true;
  if (status >= 500 && status < 600) return true;
  if (status === 429) return true;
  return false;
}

function buildOpenRouterHeaders() {
  const h = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`,
  };
  if (BASE_URL.includes('openrouter.ai')) {
    h['HTTP-Referer'] = process.env.PUBLIC_URL || 'https://claudeweb-production-9853.up.railway.app';
    h['X-Title'] = 'ClaudeFree Proxy';
  }
  return h;
}

// --- Error classification ---

function classifyError(status, originalMessage) {
  const map = {
    400: { code: 'bad_request',        zh: '请求参数无效' },
    401: { code: 'invalid_api_key',    zh: 'API Key 无效或已过期，请检查后重试' },
    402: { code: 'insufficient_balance',zh: '账户余额不足，请充值后重试' },
    403: { code: 'model_not_authorized',zh: '无权访问该模型，请更换模型或检查权限' },
    404: { code: 'endpoint_not_found',  zh: 'API 端点不存在' },
    429: { code: 'rate_limited',       zh: '请求频率过高，请稍后重试' },
    500: { code: 'provider_error',     zh: '服务商内部错误，正在重试' },
    502: { code: 'provider_unavailable',zh: '服务商网关不可用，正在切换备用模型' },
    503: { code: 'provider_overloaded', zh: '服务商过载，正在重试' },
  };
  const entry = map[status];
  return {
    code: entry?.code || 'unknown_error',
    zh_message: entry?.zh || '未知错误',
    http_status: status,
    detail: (originalMessage || '').substring(0, 500)
  };
}

// ===== Tool translation: Anthropic ↔ OpenAI =====
// cli-dev 发送 Anthropic Messages API 格式（含 tools + tool_use/tool_result 内容块）
// 本代理将其转换为 OpenAI Chat Completions 格式（tools + tool_calls/tool role），
// 并将响应转换回 Anthropic 格式，使非 Anthropic 模型也能使用工具调用。

// 流式翻译中追踪 tool_calls 的模块级状态
const toolCallBuffers = new Map();

function resetToolBuffers() {
  toolCallBuffers.clear();
}

// --- Request: Anthropic tools → OpenAI functions ---

function translateTools(anthropicTools) {
  if (!anthropicTools || !Array.isArray(anthropicTools) || anthropicTools.length === 0) return undefined;
  return anthropicTools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || { type: 'object', properties: {} }
    }
  }));
}

function translateMessages(anthropicBody) {
  const msgs = anthropicBody.messages || [];
  const systemMsg = anthropicBody.system;
  const result = [];

  // 系统消息
  if (systemMsg) {
    if (typeof systemMsg === 'string') {
      result.push({ role: 'system', content: systemMsg });
    } else if (Array.isArray(systemMsg)) {
      result.push({ role: 'system', content: systemMsg.map(s => s.text || '').join('\n') });
    }
  }

  for (const m of msgs) {
    if (typeof m.content === 'string') {
      result.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content) || m.content.length === 0) {
      result.push({ role: m.role, content: '' });
      continue;
    }

    // —— assistant 消息：包含 tool_use 内容块 ——
    if (m.role === 'assistant') {
      const toolUses = m.content.filter(c => c.type === 'tool_use');
      const textParts = m.content.filter(c => c.type === 'text').map(c => c.text).filter(Boolean);

      if (toolUses.length > 0) {
        result.push({
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('\n') : null,
          tool_calls: toolUses.map((c, i) => ({
            id: c.id || `call_${Date.now()}_${i}`,
            type: 'function',
            function: {
              name: c.name,
              arguments: JSON.stringify(c.input || {})
            }
          }))
        });
        continue;
      }
    }

    // —— user 消息：包含 tool_result 内容块 ——
    if (m.role === 'user') {
      const toolResults = m.content.filter(c => c.type === 'tool_result');
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          const content = Array.isArray(tr.content)
            ? tr.content.map(c => (typeof c === 'string' ? c : c.text || '')).join('\n')
            : (typeof tr.content === 'string' ? tr.content : '');
          result.push({ role: 'tool', tool_call_id: tr.tool_use_id, content });
        }
        continue;
      }
    }

    // —— 普通 user 消息：处理文本和图片 ——
    const text = m.content.filter(c => c.type === 'text').map(c => c.text).filter(Boolean).join('\n');
    const images = m.content.filter(c => c.type === 'image');

    if (images.length > 0) {
      const parts = [];
      if (text) parts.push({ type: 'text', text });
      for (const img of images) {
        if (img.source?.type === 'base64') {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${img.source.media_type || 'image/png'};base64,${img.source.data}` }
          });
        }
      }
      result.push({ role: m.role, content: parts });
    } else {
      result.push({ role: m.role, content: text || '' });
    }
  }

  return result;
}

// --- Response: OpenAI tool_calls → Anthropic tool_use (非流式) ---

function translateToAnthropic(orResponse, model) {
  const choice = orResponse.choices?.[0];
  const message = choice?.message;
  const finishReason = choice?.finish_reason || 'stop';

  const contentBlocks = [];

  if (message?.content) {
    contentBlocks.push({ type: 'text', text: message.content });
  }

  const toolCalls = message?.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      if (tc.type !== 'function') continue;
      let input = {};
      try { input = JSON.parse(tc.function.arguments); } catch (e) { input = { _raw: tc.function.arguments }; }
      contentBlocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
  }

  return {
    id: orResponse.id || 'msg_' + Math.random().toString(36).slice(2),
    type: 'message',
    role: 'assistant',
    content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }],
    model: orResponse.model || model || MODEL,
    stop_reason: finishReason === 'tool_calls' ? 'tool_use' : (finishReason === 'stop' ? 'end_turn' : 'max_tokens'),
    stop_sequence: null,
    usage: orResponse.usage ? {
      input_tokens: orResponse.usage.prompt_tokens || 0,
      output_tokens: orResponse.usage.completion_tokens || 0
    } : { input_tokens: 0, output_tokens: 0 }
  };
}

// --- Response: OpenAI streaming tool_calls delta → Anthropic content_block events ---

function translateStreamChunk(orChunk) {
  const delta = orChunk.choices?.[0]?.delta;
  if (!delta) return null;

  // tool_calls delta → content_block_start (first chunk with id) / content_block_delta (arguments)
  if (delta.tool_calls && delta.tool_calls.length > 0) {
    const results = [];
    for (const tc of delta.tool_calls) {
      const idx = tc.index;
      // 偏移索引：anthropic 的 index 0 是 text，tool_use 从 1 开始
      const aiIdx = 1 + idx;

      if (tc.id) {
        // 首个 chunk：发送 content_block_start
        const initialArgs = tc.function?.arguments || '';
        toolCallBuffers.set(idx, {
          id: tc.id,
          name: tc.function?.name || '',
          arguments: initialArgs
        });
        results.push({
          type: 'content_block_start',
          index: aiIdx,
          content_block: {
            type: 'tool_use',
            id: tc.id,
            name: tc.function?.name || '',
            input: {}
          }
        });
        // 如果首个 chunk 已包含 arguments，立即发送 input_json_delta
        if (initialArgs) {
          results.push({
            type: 'content_block_delta',
            index: aiIdx,
            delta: { type: 'input_json_delta', partial_json: initialArgs }
          });
        }
      } else {
        // 后续 chunk：累积 arguments 并发送 input_json_delta
        const buf = toolCallBuffers.get(idx);
        if (buf && tc.function?.arguments) {
          buf.arguments += tc.function.arguments;
          results.push({
            type: 'content_block_delta',
            index: aiIdx,
            delta: { type: 'input_json_delta', partial_json: tc.function.arguments }
          });
        }
      }
    }
    return results;
  }

  // text delta（原始行为）
  if (delta.content) {
    return {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: delta.content },
      index: 0
    };
  }

  return null;
}

// --- Request entry point ---

function translateToOpenRouter(anthropicBody, model) {
  const messages = translateMessages(anthropicBody);
  const tools = translateTools(anthropicBody.tools);
  const modelName = model || MODEL;

  const body = {
    model: modelName,
    messages,
    max_tokens: anthropicBody.max_tokens || 4096,
    temperature: anthropicBody.temperature ?? 0.7,
    stream: anthropicBody.stream || false
  };

  if (tools) body.tools = tools;

  return body;
}

// --- Core: fetch with retry & fallback ---

/**
 * Try requested model, retry on transient failures, fallback if available.
 * Returns { response, modelUsed, attempts }
 */
async function callModel(anthropicBody) {
  const attempted = [];
  const modelsToTry = [MODEL];
  if (FALLBACK_MODEL && FALLBACK_MODEL !== MODEL) modelsToTry.push(FALLBACK_MODEL);

  let lastError = null;
  let lastStatus = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const label = attempt > 0
        ? `[retry ${attempt}/${MAX_RETRIES}]`
        : (model === FALLBACK_MODEL ? '[fallback]' : '');
      console.error(`[proxy] → ${model} ${label} ${CHAT_URL}`);

      try {
        const orBody = translateToOpenRouter(anthropicBody, model);
        const resp = await fetch(CHAT_URL, {
          method: 'POST',
          headers: buildOpenRouterHeaders(),
          body: JSON.stringify(orBody),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });

        if (resp.ok) {
          attempted.push(`${model} (ok)`);
          return { response: resp, modelUsed: model, attempts: attempted };
        }

        const errText = await resp.text().catch(() => '');
        lastStatus = resp.status;
        lastError = new Error(`HTTP ${resp.status}: ${errText.substring(0, 300)}`);
        attempted.push(`${model} (${resp.status})`);

        if (!isRetryable(resp.status)) break; // 4xx → don't retry this model

        if (attempt < MAX_RETRIES) {
          const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
          console.error(`[proxy] waiting ${delay}ms before retry...`);
          await sleep(delay);
        }
      } catch (e) {
        lastError = e;
        attempted.push(`${model} (err: ${e.message})`);

        if (!isRetryable(null, e)) break;

        if (attempt < MAX_RETRIES) {
          const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
          console.error(`[proxy] waiting ${delay}ms before retry...`);
          await sleep(delay);
        }
      }
    }
  }

  throw Object.assign(lastError || new Error('All attempts failed'), {
    status: lastStatus || 502,
    attempted
  });
}

// --- HTTP Server ---

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3000');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && (req.url === '/v1/messages' || req.url?.startsWith('/v1/messages'))) {
    try {
      let body = '';
      let bodySize = 0;
      for await (const chunk of req) {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY_SIZE) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { type: 'payload_too_large', message: 'Request body too large (max 5MB)' } }));
          return;
        }
        body += chunk;
      }
      const anthropicReq = JSON.parse(body);
      const isStream = anthropicReq.stream === true;

      const { response: orResp, modelUsed, attempts } = await callModel(anthropicReq);

      console.error(`[proxy] ✓ ${modelUsed} attempts=${attempts.join(' → ')}`);

      if (isStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const reader = orResp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const MAX_BUFFER_SIZE = 1024 * 512; // 512KB buffer 上限
        let totalChars = 0;
        let totalToolBlocks = 0;
        let usageInfo = null;
        resetToolBuffers();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE buffer 保护：防止超长行耗尽内存
          if (buffer.length > MAX_BUFFER_SIZE) {
            console.error('[proxy] SSE buffer exceeded maximum size, resetting');
            buffer = '';
            continue;
          }
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') {
              // 发送 content_block_stop 给所有已追踪的 tool call
              for (const [idx] of toolCallBuffers) {
                totalToolBlocks++;
                res.write(`data: ${JSON.stringify({type: 'content_block_stop', index: 1 + idx})}\n\n`);
              }
              resetToolBuffers();
              res.write(`event: message_stop\ndata: {}\n\n`);
              continue;
            }

            try {
              const orChunk = JSON.parse(dataStr);
              // Capture usage from streaming response (OpenRouter sends usage in final chunks)
              if (orChunk.usage && !usageInfo) {
                usageInfo = orChunk.usage;
              }
              const chunk = translateStreamChunk(orChunk);
              if (chunk) {
                // translateStreamChunk 对 tool_calls delta 返回数组，对 text delta 返回单对象
                const chunks = Array.isArray(chunk) ? chunk : [chunk];
                for (const c of chunks) {
                  if (c.delta?.text) totalChars += c.delta.text.length;
                  res.write(`data: ${JSON.stringify(c)}\n\n`);
                }
              }
            } catch (e) {}
          }
        }

        // Log usage info for streaming
        if (usageInfo) {
          console.error(`[proxy] usage: input=${usageInfo.prompt_tokens || 0} output=${usageInfo.completion_tokens || 0} model=${modelUsed}`);
        }
        const toolInfo = totalToolBlocks > 0 ? `, tool_blocks=${totalToolBlocks}` : '';
        console.error(`[proxy] ← streamed ~${totalChars} chars${toolInfo} via ${modelUsed}`);
        res.end();
      } else {
        const orData = await orResp.json();
        const anthropicResp = translateToAnthropic(orData, modelUsed);
        // Log usage for non-streaming response
        if (orData.usage) {
          console.error(`[proxy] usage: input=${orData.usage.prompt_tokens || 0} output=${orData.usage.completion_tokens || 0} model=${modelUsed}`);
        }
        const toolCount = anthropicResp.content.filter(c => c.type === 'tool_use').length;
        const toolInfo = toolCount > 0 ? `, tools=${toolCount}` : '';
        console.error(`[proxy] ← ${anthropicResp.content[0]?.text?.length || 0} chars${toolInfo} via ${modelUsed}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(anthropicResp));
      }
    } catch (e) {
      const attempts = e.attempted || ['unknown'];
      const status = e.status || 502;
      const classified = classifyError(status, e.message);
      console.error(`[proxy] ✗ all failed: ${attempts.join(' → ')} → ${classified.code}`);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          type: 'api_error',
          code: classified.code,
          zh_message: classified.zh_message,
          http_status: classified.http_status,
          detail: classified.detail,
          attempts: attempts.length,
          attempted: attempts
        }
      }));
    }
    return;
  }

  if (req.url === '/v1/models' || req.url?.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const models = [{ id: MODEL, type: 'model', display_name: MODEL }];
    if (FALLBACK_MODEL) models.push({ id: FALLBACK_MODEL, type: 'model', display_name: FALLBACK_MODEL });
    res.end(JSON.stringify({ data: models, has_more: false }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { type: 'not_found', message: 'Not found' } }));
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  process.stdout.write(`port ${addr.port}\n`);
  const info = FALLBACK_MODEL
    ? `[proxy] v6 listening on 127.0.0.1:${addr.port} target=${BASE_URL} model=${MODEL} fallback=${FALLBACK_MODEL}`
    : `[proxy] v6 listening on 127.0.0.1:${addr.port} target=${BASE_URL} model=${MODEL} (no fallback)`;
  console.error(info);
});

// --- Global error handlers: prevent silent crashes ---
process.on('unhandledRejection', (reason) => {
  console.error('[proxy] UNHANDLED REJECTION:', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[proxy] UNCAUGHT EXCEPTION:', err.stack);
});

process.stdin.resume();
