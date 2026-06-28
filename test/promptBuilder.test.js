import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../src/server/runtime/promptBuilder.js';

test('buildPrompt keeps stable sections via toolResults', () => {
  const prompt = buildPrompt({
    toolInstructions: 'Tool A',
    toolResults: [{ tool: 'web_search', ok: true, content: 'Result A' }],
    userMessage: 'Hello world'
  });

  assert.match(prompt, /^\[System Instructions\]/);
  assert.match(prompt, /\[Web Search Results\]\nResult A/);
  assert.ok(prompt.endsWith('[User Message]\nHello world'));
});

test('buildPrompt omits empty sections', () => {
  const prompt = buildPrompt({ userMessage: 'Only user' });

  assert.equal(prompt, '[User Message]\nOnly user');
});

test('buildPrompt includes toolResults in stable order before user message', () => {
  const prompt = buildPrompt({
    toolInstructions: 'Tool instruction',
    toolResults: [
      { tool: 'web_search', ok: true, content: 'Search result' },
      { tool: 'file_analysis', ok: true, content: 'File context' },
      { tool: 'code_interpreter', ok: true, content: 'Code output' }
    ],
    userMessage: 'Question?'
  });

  assert.ok(prompt.indexOf('[System Instructions]') < prompt.indexOf('[Web Search Results]'));
  assert.ok(prompt.indexOf('[Web Search Results]') < prompt.indexOf('[File Analysis]'));
  assert.ok(prompt.indexOf('[File Analysis]') < prompt.indexOf('[Code Interpreter]'));
  assert.ok(prompt.indexOf('[Code Interpreter]') < prompt.indexOf('[User Message]'));
});

test('buildPrompt skips empty toolResults', () => {
  const prompt = buildPrompt({
    toolResults: [
      { tool: 'file_analysis', ok: true, content: '' }
    ],
    userMessage: 'Hello'
  });

  assert.doesNotMatch(prompt, /\[File Analysis\]/);
  assert.match(prompt, /\[User Message\]\nHello/);
});
