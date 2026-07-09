import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../src/server/runtime/promptBuilder.js';

test('buildPrompt keeps stable sections via toolResults', () => {
  const { systemPrompt, userMessage, tools } = buildPrompt({
    toolInstructions: 'Tool A',
    toolResults: [{ tool: 'web_search', ok: true, content: 'Result A' }],
    userMessage: 'Hello world'
  });

  assert.match(systemPrompt, /^You are an interactive agent/);
  assert.match(systemPrompt, /\[Web Search Results\]\nResult A/);
  assert.equal(userMessage, 'Hello world');
  assert.ok(Array.isArray(tools));
});

test('buildPrompt omits empty sections', () => {
  const { systemPrompt, userMessage, tools } = buildPrompt({ userMessage: 'Only user' });

  assert.match(systemPrompt, /^You are an interactive agent/);
  assert.equal(userMessage, 'Only user');
  assert.ok(Array.isArray(tools));
});

test('buildPrompt includes toolResults in stable order before tools section', () => {
  const { systemPrompt } = buildPrompt({
    toolInstructions: 'Tool instruction',
    toolResults: [
      { tool: 'web_search', ok: true, content: 'Search result' },
      { tool: 'file_analysis', ok: true, content: 'File context' },
      { tool: 'code_interpreter', ok: true, content: 'Code output' }
    ],
    userMessage: 'Question?'
  });

  assert.ok(systemPrompt.indexOf('[Web Search Results]') < systemPrompt.indexOf('[File Analysis]'));
  assert.ok(systemPrompt.indexOf('[File Analysis]') < systemPrompt.indexOf('[Code Interpreter]'));
});

test('buildPrompt skips empty toolResults', () => {
  const { systemPrompt, userMessage } = buildPrompt({
    toolResults: [
      { tool: 'file_analysis', ok: true, content: '' }
    ],
    userMessage: 'Hello'
  });

  assert.doesNotMatch(systemPrompt, /\[File Analysis\]/);
  assert.equal(userMessage, 'Hello');
});

test('buildPrompt includes conversation history before tools section', () => {
  const { systemPrompt, userMessage } = buildPrompt({
    userMessage: 'Third message',
    history: [
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Second message' }
    ]
  });

  assert.ok(systemPrompt.indexOf('[Conversation History]') > -1);
  assert.match(systemPrompt, /user: First message/);
  assert.match(systemPrompt, /assistant: First response/);
  assert.match(systemPrompt, /user: Second message/);
  assert.equal(userMessage, 'Third message');
});

test('buildPrompt handles empty history gracefully', () => {
  const { systemPrompt, userMessage } = buildPrompt({ userMessage: 'Hello', history: [] });
  assert.doesNotMatch(systemPrompt, /\[Conversation History\]/);
  assert.equal(userMessage, 'Hello');
});
