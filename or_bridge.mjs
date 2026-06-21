#!/usr/bin/env node
/**
 * or-bridge: drop-in replacement for free-code --print mode using OpenRouter
 * Reads prompt from stdin, calls OpenRouter Chat Completions API, writes to stdout.
 * 
 * Usage: node or-bridge.mjs --model nvidia/nemotron-3-ultra-550b-a55b:free
 * Env: ANTHROPIC_API_KEY = OpenRouter API key
 *      ANTHROPIC_BASE_URL = unused by bridge (hardcoded to OpenRouter)
 */
import { createInterface } from 'readline';

const args = process.argv.slice(2);
const modelIdx = args.indexOf('--model');
const MODEL = modelIdx >= 0 ? args[modelIdx + 1] : 'nvidia/nemotron-3-ultra-550b-a55b:free';
const KEY = process.env.ANTHROPIC_API_KEY || '';

const rl = createInterface({ input: process.stdin });
let prompt = '';

rl.on('line', (line) => {
  prompt += line + '\n';
});

rl.on('close', async () => {
  if (!prompt.trim()) {
    process.exit(0);
  }
  
  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: prompt.trim() }],
    max_tokens: 4096,
    temperature: 0.7,
  });

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KEY}`,
        'HTTP-Referer': 'https://claudefree-production.up.railway.app',
        'X-Title': 'ClaudeFree Bridge',
      },
      body,
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      process.stderr.write(`OpenRouter error ${resp.status}: ${errText}\n`);
      process.exit(1);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    process.stdout.write(content);
  } catch (e) {
    process.stderr.write(`Bridge error: ${e.message}\n`);
    process.exit(1);
  }
});
