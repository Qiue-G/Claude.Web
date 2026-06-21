#!/usr/bin/env node
/**
 * or-proxy: Local HTTP proxy translating Anthropic Messages API -> OpenRouter Chat Completions.
 * Outputs port number on first stdout line, then listens.
 *
 * Usage: node or-bridge.mjs --model nvidia/nemotron-3-ultra-550b-a55b:free
 * Env: ANTHROPIC_API_KEY = OpenRouter API key
 */

import http from 'http';

const args = process.argv.slice(2);
const modelIdx = args.indexOf('--model');
const MODEL = modelIdx >= 0 ? args[modelIdx + 1] : 'nvidia/nemotron-3-ultra-550b-a55b:free';
const KEY = process.env.ANTHROPIC_API_KEY || '';

// Find random available port
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: MODEL, object: 'model' }] }));
    return;
  }

  if (req.url === '/v1/messages' || req.url === '/v1/messages?beta=true') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const msg = JSON.parse(body);
        // Convert Anthropic Messages -> OpenRouter Chat Completions
        const messages = msg.messages || [];
        let system = '';
        const chatMessages = [];

        for (const m of messages) {
          if (m.role === 'system') {
            system = typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '');
          } else {
            const content = typeof m.content === 'string' ? m.content : (m.content?.map(c => c.text || '').join('') || '');
            chatMessages.push({ role: m.role, content });
          }
        }

        // If system message from Anthropic top-level, prepend
        if (msg.system && !system) {
          system = typeof msg.system === 'string' ? msg.system : (msg.system?.map(s => s.text || '').join('') || '');
        }
        if (system) {
          chatMessages.unshift({ role: 'system', content: system });
        }

        const orBody = JSON.stringify({
          model: MODEL,
          messages: chatMessages,
          max_tokens: msg.max_tokens || 4096,
          temperature: msg.temperature ?? 0.7,
          stream: false,
        });

        const orResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${KEY}`,
            'HTTP-Referer': 'https://claudefree-production.up.railway.app',
            'X-Title': 'ClaudeFree Proxy',
          },
          body: orBody,
          signal: AbortSignal.timeout(120000),
        });

        if (!orResp.ok) {
          const errText = await orResp.text();
          res.writeHead(orResp.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', error: { message: `OpenRouter ${orResp.status}: ${errText}` } }));
          return;
        }

        const data = await orResp.json();
        const content = data.choices?.[0]?.message?.content || '';
        const finishReason = data.choices?.[0]?.finish_reason || 'stop';

        // Convert OpenRouter -> Anthropic Messages format
        const anthropicResp = {
          id: data.id || 'msg_' + Date.now(),
          type: 'message',
          role: 'assistant',
          model: MODEL,
          content: [{ type: 'text', text: content }],
          stop_reason: finishReason === 'stop' ? 'end_turn' : finishReason,
          stop_sequence: null,
          usage: {
            input_tokens: data.usage?.prompt_tokens || 0,
            output_tokens: data.usage?.completion_tokens || 0,
          },
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(anthropicResp));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { message: e.message } }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  // Output port number as first stdout line (required by spawnWithProxy)
  process.stdout.write(port.toString() + '\n');
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
