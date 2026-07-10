#!/usr/bin/env node
/**
 * OpenAI API 代理服务器
 * 将 Anthropic Messages API 格式转换为 OpenAI Chat Completions API 格式
 */

import { createServer } from 'node:http';
import { parseArgs } from 'node:util';

const args = parseArgs({
  options: {
    model: { type: 'string', default: 'gpt-4o' },
    'base-url': { type: 'string', default: 'https://api.openai.com/v1' },
  },
}).values;

const MODEL = args.model;
const BASE_URL = args['base-url'];
const PORT = 0; // 随机端口

// 消息格式转换：Anthropic → OpenAI
export function translateMessages(anthropicMessages) {
  return anthropicMessages.map(msg => {
    if (msg.role === 'user') {
      return {
        role: 'user',
        content: Array.isArray(msg.content)
          ? msg.content.map(c => c.type === 'text' ? c.text : '').join('')
          : msg.content
      };
    }
    if (msg.role === 'assistant') {
      return {
        role: 'assistant',
        content: Array.isArray(msg.content)
          ? msg.content.map(c => c.type === 'text' ? c.text : '').join('')
          : msg.content
      };
    }
    return msg;
  });
}

// 工具格式转换：Anthropic → OpenAI
export function translateTools(anthropicTools) {
  if (!anthropicTools) return undefined;
  
  return anthropicTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }
  }));
}

// 请求体转换
export function translateToOpenAI(anthropicBody) {
  return {
    model: anthropicBody.model || MODEL,
    messages: translateMessages(anthropicBody.messages || []),
    max_tokens: anthropicBody.max_tokens || 4096,
    temperature: anthropicBody.temperature ?? 0.7,
    stream: anthropicBody.stream || false,
    tools: translateTools(anthropicBody.tools),
    tool_choice: anthropicBody.tool_choice === 'required' ? 'auto' : anthropicBody.tool_choice
  };
}

// 流式响应转换
export function translateStreamChunk(openaiChunk) {
  const delta = openaiChunk.choices?.[0]?.delta;
  if (!delta) return null;

  // 文本增量
  if (delta.content) {
    return {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: delta.content },
      index: 0
    };
  }

  // 工具调用增量
  if (delta.tool_calls) {
    const tc = delta.tool_calls[0];
    if (tc.function) {
      return {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
        index: 1 + (tc.index || 0)
      };
    }
  }

  return null;
}

// HTTP 服务器
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/messages') {
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      
      const anthropicReq = JSON.parse(body);
      const openaiReq = translateToOpenAI(anthropicReq);
      const isStream = openaiReq.stream;

      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY || ''}`
        },
        body: JSON.stringify(openaiReq)
      });

      if (isStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') {
              res.write('event: message_stop\ndata: {}\n\n');
              continue;
            }

            try {
              const openaiChunk = JSON.parse(dataStr);
              const anthropicChunk = translateStreamChunk(openaiChunk);
              if (anthropicChunk) {
                res.write(`data: ${JSON.stringify(anthropicChunk)}\n\n`);
              }
            } catch (e) {}
          }
        }

        res.end();
      } else {
        const data = await response.json();
        const anthropicResp = {
          id: data.id,
          type: 'message',
          role: 'assistant',
          content: data.choices[0].message.content
            ? [{ type: 'text', text: data.choices[0].message.content }]
            : [],
          model: data.model,
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: data.usage?.prompt_tokens || 0,
            output_tokens: data.usage?.completion_tokens || 0
          }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(anthropicResp));
      }
    } catch (e) {
      console.error('[openai_proxy] Error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'api_error', message: e.message } }));
    }
  }
});

// 仅当作为主模块运行时启动服务器
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('openai_proxy.mjs') ||
  process.argv[1].endsWith('openai_proxy')
);

if (isMainModule) {
  server.listen(PORT, '127.0.0.1', () => {
    const addr = server.address();
    process.stdout.write(`port ${addr.port}\n`);
    console.error(`[openai_proxy] listening on 127.0.0.1:${addr.port}`);
  });
}

export { server };
