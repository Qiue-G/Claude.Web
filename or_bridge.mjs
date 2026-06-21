#!/usr/bin/env node
// or-bridge: stdin/stdout bridge calling OpenRouter Chat Completions.
// Reads prompt from stdin, writes response to stdout, errors to stderr.
// Outputs "0" as first stdout line so spawner knows it started.

const args = process.argv.slice(2);
const modelIdx = args.indexOf('--model');
const MODEL = modelIdx >= 0 ? args[modelIdx + 1] : 'nvidia/nemotron-3-ultra-550b-a55b:free';
const KEY = process.env.ANTHROPIC_API_KEY || '';

process.stdout.write('0\n');

async function main() {
  let prompt = '';
  for await (const chunk of process.stdin) { prompt += chunk; }
  
  if (!prompt.trim()) { process.exit(0); }

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + KEY,
        'HTTP-Referer': 'https://claudefree-production.up.railway.app',
        'X-Title': 'ClaudeFree Bridge',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt.trim() }],
        max_tokens: 4096, temperature: 0.7,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      process.stderr.write('OpenRouter error ' + resp.status + ': ' + (await resp.text()).substring(0,200) + '\n');
      process.exit(1);
    }

    const data = await resp.json();
    process.stdout.write(data.choices?.[0]?.message?.content || '');
    process.exit(0);
  } catch (e) {
    process.stderr.write('Bridge error: ' + e.message + '\n');
    process.exit(1);
  }
}
main();
