/**
 * or_proxy.mjs v5
 * Local proxy: Anthropic Messages API → OpenAI Chat Completions
 * Supports OpenRouter, DeepSeek, and any OpenAI-compatible API.
 * v5: retry on transient failures + fallback model health degradation.
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
    h['HTTP-Referer'] = 'https://claudefree-production.up.railway.app';
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

// --- Translation functions ---

function translateToOpenRouter(anthropicBody, model) {
  const msgs = anthropicBody.messages || [];
  const systemMsg = anthropicBody.system;
  const messages = [];

  if (systemMsg) {
    if (typeof systemMsg === 'string') {
      messages.push({ role: 'system', content: systemMsg });
    } else if (Array.isArray(systemMsg)) {
      messages.push({ role: 'system', content: systemMsg.map(s => s.text || '').join('\n') });
    }
  }

  for (const m of msgs) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      const text = m.content.map(c => c.text || c.type || '').join('\n');
      messages.push({ role: m.role, content: text });
    }
  }

  return {
    model: model || MODEL,
    messages,
    max_tokens: anthropicBody.max_tokens || 4096,
    temperature: anthropicBody.temperature ?? 0.7,
    stream: anthropicBody.stream || false
  };
}

function translateToAnthropic(orResponse, model) {
  const choice = orResponse.choices?.[0];
  const content = choice?.message?.content || '';
  const finishReason = choice?.finish_reason || 'stop';

  return {
    id: orResponse.id || 'msg_' + Math.random().toString(36).slice(2),
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model: orResponse.model || model || MODEL,
    stop_reason: finishReason === 'stop' ? 'end_turn' : 'max_tokens',
    stop_sequence: null,
    usage: orResponse.usage ? {
      input_tokens: orResponse.usage.prompt_tokens || 0,
      output_tokens: orResponse.usage.completion_tokens || 0
    } : { input_tokens: 0, output_tokens: 0 }
  };
}

function translateStreamChunk(orChunk) {
  const delta = orChunk.choices?.[0]?.delta;
  if (!delta || !delta.content) return null;

  return {
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: delta.content },
    index: 0
  };
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
      for await (const chunk of req) body += chunk;
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
        let totalChars = 0;
        let usageInfo = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') {
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
                totalChars += (chunk.delta?.text?.length || 0);
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            } catch (e) {}
          }
        }

        // Log usage info for streaming
        if (usageInfo) {
          console.error(`[proxy] usage: input=${usageInfo.prompt_tokens || 0} output=${usageInfo.completion_tokens || 0} model=${modelUsed}`);
        }
        console.error(`[proxy] ← streamed ~${totalChars} chars via ${modelUsed}`);
        res.end();
      } else {
        const orData = await orResp.json();
        const anthropicResp = translateToAnthropic(orData, modelUsed);
        console.error(`[proxy] ← ${anthropicResp.content[0]?.text?.length || 0} chars via ${modelUsed}`);
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
  process.stdout.write(String(addr.port));
  const info = FALLBACK_MODEL
    ? `[proxy] v5 listening on 127.0.0.1:${addr.port} target=${BASE_URL} model=${MODEL} fallback=${FALLBACK_MODEL}`
    : `[proxy] v5 listening on 127.0.0.1:${addr.port} target=${BASE_URL} model=${MODEL} (no fallback)`;
  console.error(info);
});

process.stdin.resume();
