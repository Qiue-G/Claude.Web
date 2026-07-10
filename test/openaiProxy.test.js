import test from 'node:test';
import assert from 'node:assert/strict';
import {
  translateMessages,
  translateTools,
  translateToOpenAI,
  translateStreamChunk
} from '../openai_proxy.mjs';

test('openai_proxy.mjs - translateMessages', async (t) => {
  await t.test('should convert user message with text content', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
    ];
    const result = translateMessages(messages);
    assert.equal(result.length, 1);
    assert.equal(result[0].role, 'user');
    assert.equal(result[0].content, 'Hello');
  });

  await t.test('should convert user message with string content', () => {
    const messages = [
      { role: 'user', content: 'Hello' }
    ];
    const result = translateMessages(messages);
    assert.equal(result[0].content, 'Hello');
  });

  await t.test('should convert assistant message with text content', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] }
    ];
    const result = translateMessages(messages);
    assert.equal(result[0].role, 'assistant');
    assert.equal(result[0].content, 'Hi there');
  });

  await t.test('should handle multiple messages', () => {
    const messages = [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer' }
    ];
    const result = translateMessages(messages);
    assert.equal(result.length, 2);
    assert.equal(result[0].content, 'Question');
    assert.equal(result[1].content, 'Answer');
  });
});

test('openai_proxy.mjs - translateTools', async (t) => {
  await t.test('should return undefined for null tools', () => {
    const result = translateTools(null);
    assert.equal(result, undefined);
  });

  await t.test('should return undefined for undefined tools', () => {
    const result = translateTools(undefined);
    assert.equal(result, undefined);
  });

  await t.test('should convert Anthropic tool format to OpenAI format', () => {
    const tools = [
      {
        name: 'get_weather',
        description: 'Get weather info',
        input_schema: {
          type: 'object',
          properties: {
            location: { type: 'string' }
          }
        }
      }
    ];
    const result = translateTools(tools);
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'function');
    assert.equal(result[0].function.name, 'get_weather');
    assert.equal(result[0].function.description, 'Get weather info');
    assert.deepEqual(result[0].function.parameters, tools[0].input_schema);
  });

  await t.test('should handle multiple tools', () => {
    const tools = [
      { name: 'tool1', description: 'Tool 1', input_schema: {} },
      { name: 'tool2', description: 'Tool 2', input_schema: {} }
    ];
    const result = translateTools(tools);
    assert.equal(result.length, 2);
    assert.equal(result[0].function.name, 'tool1');
    assert.equal(result[1].function.name, 'tool2');
  });
});

test('openai_proxy.mjs - translateToOpenAI', async (t) => {
  await t.test('should convert basic request', () => {
    const body = {
      model: 'claude-3',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 1000,
      temperature: 0.5
    };
    const result = translateToOpenAI(body);
    assert.equal(result.model, 'claude-3');
    assert.equal(result.max_tokens, 1000);
    assert.equal(result.temperature, 0.5);
    assert.equal(result.stream, false);
  });

  await t.test('should use default model when not provided', () => {
    const body = {
      messages: [{ role: 'user', content: 'Hello' }]
    };
    const result = translateToOpenAI(body);
    assert.equal(result.model, 'gpt-4o');
  });

  await t.test('should use default max_tokens when not provided', () => {
    const body = {
      messages: [{ role: 'user', content: 'Hello' }]
    };
    const result = translateToOpenAI(body);
    assert.equal(result.max_tokens, 4096);
  });

  await t.test('should use default temperature when not provided', () => {
    const body = {
      messages: [{ role: 'user', content: 'Hello' }]
    };
    const result = translateToOpenAI(body);
    assert.equal(result.temperature, 0.7);
  });

  await t.test('should convert tool_choice required to auto', () => {
    const body = {
      messages: [{ role: 'user', content: 'Hello' }],
      tool_choice: 'required'
    };
    const result = translateToOpenAI(body);
    assert.equal(result.tool_choice, 'auto');
  });

  await t.test('should preserve other tool_choice values', () => {
    const body = {
      messages: [{ role: 'user', content: 'Hello' }],
      tool_choice: 'auto'
    };
    const result = translateToOpenAI(body);
    assert.equal(result.tool_choice, 'auto');
  });

  await t.test('should include tools when provided', () => {
    const body = {
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [{ name: 'test', description: 'Test tool', input_schema: {} }]
    };
    const result = translateToOpenAI(body);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].type, 'function');
  });
});

test('openai_proxy.mjs - translateStreamChunk', async (t) => {
  await t.test('should convert text content delta', () => {
    const chunk = {
      choices: [{
        delta: { content: 'Hello' }
      }]
    };
    const result = translateStreamChunk(chunk);
    assert.equal(result.type, 'content_block_delta');
    assert.equal(result.delta.type, 'text_delta');
    assert.equal(result.delta.text, 'Hello');
    assert.equal(result.index, 0);
  });

  await t.test('should convert tool call delta', () => {
    const chunk = {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: '{"location":' }
          }]
        }
      }]
    };
    const result = translateStreamChunk(chunk);
    assert.equal(result.type, 'content_block_delta');
    assert.equal(result.delta.type, 'input_json_delta');
    assert.equal(result.delta.partial_json, '{"location":');
    assert.equal(result.index, 1);
  });

  await t.test('should return null for empty delta', () => {
    const chunk = {
      choices: [{ delta: {} }]
    };
    const result = translateStreamChunk(chunk);
    assert.equal(result, null);
  });

  await t.test('should return null for missing choices', () => {
    const chunk = {};
    const result = translateStreamChunk(chunk);
    assert.equal(result, null);
  });

  await t.test('should handle tool call with different index', () => {
    const chunk = {
      choices: [{
        delta: {
          tool_calls: [{
            index: 2,
            function: { arguments: '{}' }
          }]
        }
      }]
    };
    const result = translateStreamChunk(chunk);
    assert.equal(result.index, 3);
  });
});
