/**
 * or_proxy.mjs v4
 * Local proxy that translates Anthropic Messages API → OpenAI Chat Completions
 * Supports OpenRouter, DeepSeek, and any OpenAI-compatible API.
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

function translateToOpenRouter(anthropicBody) {
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
    model: MODEL,
    messages,
    max_tokens: anthropicBody.max_tokens || 4096,
    temperature: anthropicBody.temperature ?? 0.7,
    stream: anthropicBody.stream || false
  };
}

function translateToAnthropic(orResponse) {
  const choice = orResponse.choices?.[0];
  const content = choice?.message?.content || '';
  const finishReason = choice?.finish_reason || 'stop';

  return {
    id: orResponse.id || 'msg_' + Math.random().toString(36).slice(2),
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model: orResponse.model || MODEL,
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

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');

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
      const orBody = translateToOpenRouter(anthropicReq);

      console.error(`[proxy] → ${BASE_URL} model=${MODEL} stream=${isStream}`);

      const fetchHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KEY}`,
      };
      if (BASE_URL.includes('openrouter.ai')) {
        fetchHeaders['HTTP-Referer'] = 'https://claudefree-production.up.railway.app';
        fetchHeaders['X-Title'] = 'ClaudeFree Proxy';
      }

      const orResp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: fetchHeaders,
        body: JSON.stringify(orBody),
        signal: AbortSignal.timeout(120000),
      });

      if (!orResp.ok) {
        const errText = await orResp.text();
        console.error(`[proxy] API error ${orResp.status}: ${errText}`);
        res.writeHead(orResp.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'api_error', message: errText.substring(0, 500) } }));
        return;
      }

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
              const chunk = translateStreamChunk(orChunk);
              if (chunk) {
                totalChars += (chunk.delta?.text?.length || 0);
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            } catch (e) {}
          }
        }

        console.error(`[proxy] ← streamed ~${totalChars} chars`);
        res.end();
      } else {
        const orData = await orResp.json();
        const anthropicResp = translateToAnthropic(orData);
        console.error(`[proxy] ← ${anthropicResp.content[0]?.text?.length || 0} chars`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(anthropicResp));
      }
    } catch (e) {
      console.error(`[proxy] error: ${e.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'api_error', message: e.message } }));
    }
    return;
  }

  if (req.url === '/v1/models' || req.url?.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: [{ id: MODEL, type: 'model', display_name: MODEL }],
      has_more: false
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { type: 'not_found', message: 'Not found' } }));
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  process.stdout.write(String(addr.port));
  console.error(`[proxy] listening on 127.0.0.1:${addr.port} target=${BASE_URL}`);
});

process.stdin.resume();
