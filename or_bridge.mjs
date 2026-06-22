#!/usr/bin/env node
// or-bridge v2: stdin/stdout bridge calling OpenRouter Chat Completions.
// stdin: JSON array of messages [{"role":"user","content":"..."},{"role":"assistant","content":"..."}]
// stdout: response text (first line is "0" startup signal)
// stderr: errors

const args = process.argv.slice(2);
const modelIdx = args.indexOf('--model');
const MODEL = modelIdx >= 0 ? args[modelIdx + 1] : 'nvidia/nemotron-3-ultra-550b-a55b:free';
const KEY = process.env.ANTHROPIC_API_KEY || '';

process.stdout.write('0\n');

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; }

  let messages;
  try {
    messages = JSON.parse(raw);
    if (!Array.isArray(messages)) throw new Error('Not an array');
  } catch (e) {
    messages = [{ role: 'user', content: raw.trim() }];
  }

  if (!messages.length || !messages.some(m => m.content && m.content.trim())) {
    process.exit(0);
  }

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
        messages: messages,
        max_tokens: 4096,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      process.stderr.write('OpenRouter error ' + resp.status + ': ' + (await resp.text()).substring(0, 300) + '\n');
      process.exit(1);
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || '';
    process.stdout.write(reply);
    process.exit(0);
  } catch (e) {
    process.stderr.write('Bridge error: ' + e.message + '\n');
    process.exit(1);
  }
}
main();