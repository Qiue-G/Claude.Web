import test from 'node:test';
import assert from 'node:assert/strict';
import { getToolDefinitions, getToolInstructions, isToolConfigured } from '../src/server/tools/registry.js';

test('getToolInstructions returns only known enabled tools in stable order', () => {
  const text = getToolInstructions(['code_interpreter', 'unknown', 'web_search', 'web_search']);

  assert.match(text, /search the web/i);
  assert.match(text, /execute Python/i);
  assert.doesNotMatch(text, /unknown/i);
  assert.ok(text.indexOf('web search') < text.indexOf('Python'));
});

test('image_generation is exposed as unconfigured until an API key exists', () => {
  assert.equal(isToolConfigured('image_generation', {}), false);
  assert.equal(isToolConfigured('web_search', {}), true);
});

test('getToolDefinitions returns UI metadata and configuration state', () => {
  const tools = getToolDefinitions({});
  const imageGeneration = tools.find(tool => tool.id === 'image_generation');

  assert.ok(imageGeneration);
  assert.equal(imageGeneration.label, 'Image Generation');
  assert.equal(imageGeneration.icon, 'eye');
  assert.equal(imageGeneration.configured, false);
  assert.equal(imageGeneration.unavailableReason, 'missing API key');
});
