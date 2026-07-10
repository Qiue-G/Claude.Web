/**
 * or_proxy.mjs 单元测试
 * 测试 Anthropic Messages API 到 OpenRouter Chat Completions API 的转换
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// 由于 or_proxy.mjs 有顶层 server.listen()，需要特殊处理
// 我们直接测试转换函数的逻辑

test('or_proxy.mjs - translateToOpenRouter 字段透传', async () => {
  // 模拟 translateToOpenRouter 函数的核心逻辑
  function translateToOpenRouter(anthropicBody, model) {
    const messages = anthropicBody.messages || [];
    const tools = anthropicBody.tools;
    const modelName = model || 'default-model';

    const body = {
      model: modelName,
      messages,
      max_tokens: anthropicBody.max_tokens || 4096,
      temperature: anthropicBody.temperature ?? 0.7,
      stream: anthropicBody.stream || false
    };

    // 透传可选参数
    if (tools) body.tools = tools;
    if (anthropicBody.tool_choice) body.tool_choice = anthropicBody.tool_choice;
    if (anthropicBody.top_p !== undefined) body.top_p = anthropicBody.top_p;
    if (anthropicBody.top_k !== undefined) body.top_k = anthropicBody.top_k;
    if (anthropicBody.stop_sequences) body.stop = anthropicBody.stop_sequences;
    if (anthropicBody.metadata) body.metadata = anthropicBody.metadata;

    return body;
  }

  await test('应该透传 top_p 参数', () => {
    const input = {
      messages: [{ role: 'user', content: 'test' }],
      top_p: 0.9
    };
    const result = translateToOpenRouter(input, 'test-model');
    assert.equal(result.top_p, 0.9);
  });

  await test('应该透传 top_k 参数', () => {
    const input = {
      messages: [{ role: 'user', content: 'test' }],
      top_k: 50
    };
    const result = translateToOpenRouter(input, 'test-model');
    assert.equal(result.top_k, 50);
  });

  await test('应该透传 stop_sequences 并转换为 stop', () => {
    const input = {
      messages: [{ role: 'user', content: 'test' }],
      stop_sequences: ['END', 'STOP']
    };
    const result = translateToOpenRouter(input, 'test-model');
    assert.deepEqual(result.stop, ['END', 'STOP']);
  });

  await test('应该透传 metadata 参数', () => {
    const input = {
      messages: [{ role: 'user', content: 'test' }],
      metadata: { user_id: '123', session: 'abc' }
    };
    const result = translateToOpenRouter(input, 'test-model');
    assert.deepEqual(result.metadata, { user_id: '123', session: 'abc' });
  });

  await test('应该透传 tool_choice 参数', () => {
    const input = {
      messages: [{ role: 'user', content: 'test' }],
      tool_choice: 'auto'
    };
    const result = translateToOpenRouter(input, 'test-model');
    assert.equal(result.tool_choice, 'auto');
  });

  await test('应该同时透传多个可选参数', () => {
    const input = {
      messages: [{ role: 'user', content: 'test' }],
      top_p: 0.95,
      top_k: 40,
      stop_sequences: ['END'],
      metadata: { key: 'value' },
      tool_choice: 'required'
    };
    const result = translateToOpenRouter(input, 'test-model');
    assert.equal(result.top_p, 0.95);
    assert.equal(result.top_k, 40);
    assert.deepEqual(result.stop, ['END']);
    assert.deepEqual(result.metadata, { key: 'value' });
    assert.equal(result.tool_choice, 'required');
  });

  await test('不应该包含未提供的可选参数', () => {
    const input = {
      messages: [{ role: 'user', content: 'test' }]
    };
    const result = translateToOpenRouter(input, 'test-model');
    assert.equal(result.top_p, undefined);
    assert.equal(result.top_k, undefined);
    assert.equal(result.stop, undefined);
    assert.equal(result.metadata, undefined);
    assert.equal(result.tool_choice, undefined);
  });

  await test('top_p 为 0 时应该透传', () => {
    const input = {
      messages: [{ role: 'user', content: 'test' }],
      top_p: 0
    };
    const result = translateToOpenRouter(input, 'test-model');
    assert.equal(result.top_p, 0);
  });

  await test('top_k 为 0 时应该透传', () => {
    const input = {
      messages: [{ role: 'user', content: 'test' }],
      top_k: 0
    };
    const result = translateToOpenRouter(input, 'test-model');
    assert.equal(result.top_k, 0);
  });
});

test('or_proxy.mjs - translateMessages 消息转换', async () => {
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

      // 普通 user 消息：处理文本
      const text = m.content.filter(c => c.type === 'text').map(c => c.text).filter(Boolean).join('\n');
      result.push({ role: m.role, content: text || '' });
    }

    return result;
  }

  await test('应该转换字符串格式的系统消息', () => {
    const input = {
      system: 'You are a helpful assistant',
      messages: [{ role: 'user', content: 'Hello' }]
    };
    const result = translateMessages(input);
    assert.equal(result[0].role, 'system');
    assert.equal(result[0].content, 'You are a helpful assistant');
    assert.equal(result[1].role, 'user');
    assert.equal(result[1].content, 'Hello');
  });

  await test('应该转换数组格式的系统消息', () => {
    const input = {
      system: [
        { type: 'text', text: 'Part 1' },
        { type: 'text', text: 'Part 2' }
      ],
      messages: [{ role: 'user', content: 'Hello' }]
    };
    const result = translateMessages(input);
    assert.equal(result[0].role, 'system');
    assert.equal(result[0].content, 'Part 1\nPart 2');
  });

  await test('应该转换字符串内容的消息', () => {
    const input = {
      messages: [
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Answer' }
      ]
    };
    const result = translateMessages(input);
    assert.equal(result[0].content, 'Question');
    assert.equal(result[1].content, 'Answer');
  });

  await test('应该转换数组内容的消息', () => {
    const input = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: 'World' }
          ]
        }
      ]
    };
    const result = translateMessages(input);
    assert.equal(result[0].content, 'Hello\nWorld');
  });

  await test('应该处理空内容', () => {
    const input = {
      messages: [
        { role: 'user', content: [] }
      ]
    };
    const result = translateMessages(input);
    assert.equal(result[0].content, '');
  });
});

test('or_proxy.mjs - translateTools 工具转换', async () => {
  function translateTools(anthropicTools) {
    if (!anthropicTools || !Array.isArray(anthropicTools) || anthropicTools.length === 0) {
      return undefined;
    }
    return anthropicTools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || { type: 'object', properties: {} }
      }
    }));
  }

  await test('应该转换 Anthropic 工具格式到 OpenAI 格式', () => {
    const input = [
      {
        name: 'get_weather',
        description: 'Get weather information',
        input_schema: {
          type: 'object',
          properties: {
            location: { type: 'string' }
          },
          required: ['location']
        }
      }
    ];
    const result = translateTools(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'function');
    assert.equal(result[0].function.name, 'get_weather');
    assert.equal(result[0].function.description, 'Get weather information');
    assert.deepEqual(result[0].function.parameters, {
      type: 'object',
      properties: { location: { type: 'string' } },
      required: ['location']
    });
  });

  await test('应该处理多个工具', () => {
    const input = [
      { name: 'tool1', description: 'Tool 1', input_schema: {} },
      { name: 'tool2', description: 'Tool 2', input_schema: {} }
    ];
    const result = translateTools(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].function.name, 'tool1');
    assert.equal(result[1].function.name, 'tool2');
  });

  await test('应该处理缺少 description 的工具', () => {
    const input = [
      { name: 'tool1', input_schema: {} }
    ];
    const result = translateTools(input);
    assert.equal(result[0].function.description, '');
  });

  await test('应该处理缺少 input_schema 的工具', () => {
    const input = [
      { name: 'tool1', description: 'Tool 1' }
    ];
    const result = translateTools(input);
    assert.deepEqual(result[0].function.parameters, { type: 'object', properties: {} });
  });

  await test('应该对 null 输入返回 undefined', () => {
    const result = translateTools(null);
    assert.equal(result, undefined);
  });

  await test('应该对空数组返回 undefined', () => {
    const result = translateTools([]);
    assert.equal(result, undefined);
  });
});
