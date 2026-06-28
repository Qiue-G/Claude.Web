# File Analysis Tool Result Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a backend File Analysis tool, standardize tool result handling, and route file context through Prompt Builder without changing the existing WebSocket protocol.

**Architecture:** Keep the existing Svelte + Express + WebSocket flow intact. Add a focused backend `fileAnalysis` tool that accepts the current attachment text context, returns a structured tool result, and let `promptBuilder` compose tool sections in a stable order. Existing frontend attachment cards and `readFilesForAI()` behavior remain unchanged.

**Tech Stack:** Node.js ES modules, Express, Svelte, `node:test`, `node:assert/strict`, existing WebSocket/free-code/or_proxy runtime.

---

## File Structure

- Create: `src/server/tools/fileAnalysis.js`
  - Responsibility: parse the current attachment text context into a structured File Analysis tool result.
- Modify: `src/server/runtime/promptBuilder.js`
  - Responsibility: support `toolResults` while preserving existing `toolInstructions`, `webSearchResults`, and `userMessage` compatibility.
- Modify: `src/server/index.js`
  - Responsibility: when `file_analysis` is enabled and the prompt contains attachment context, run `analyzeFilesFromPromptContext()` and pass the result to `buildPrompt()`.
- Modify: `test/promptBuilder.test.js`
  - Responsibility: verify stable prompt section ordering with tool results.
- Create: `test/fileAnalysis.test.js`
  - Responsibility: verify File Analysis result format, truncation marker handling, multiple files, unsupported file messages, and empty input.

---

### Task 1: Add File Analysis unit tests

**Files:**
- Create: `test/fileAnalysis.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/fileAnalysis.test.js` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFilesFromPromptContext } from '../src/server/tools/fileAnalysis.js';

test('analyzeFilesFromPromptContext returns empty result for blank context', () => {
  const result = analyzeFilesFromPromptContext('');

  assert.equal(result.tool, 'file_analysis');
  assert.equal(result.ok, true);
  assert.equal(result.content, '');
  assert.deepEqual(result.files, []);
  assert.equal(result.metadata.totalFiles, 0);
});

test('analyzeFilesFromPromptContext extracts one text file block', () => {
  const result = analyzeFilesFromPromptContext('--- notes.md ---\nHello world\nSecond line');

  assert.equal(result.tool, 'file_analysis');
  assert.equal(result.ok, true);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, 'notes.md');
  assert.equal(result.files[0].truncated, false);
  assert.match(result.content, /File: notes\.md/);
  assert.match(result.content, /Hello world/);
});

test('analyzeFilesFromPromptContext extracts multiple file blocks', () => {
  const context = [
    '--- a.md ---\nAlpha',
    '--- b.txt ---\nBeta'
  ].join('\n\n');
  const result = analyzeFilesFromPromptContext(context);

  assert.equal(result.files.length, 2);
  assert.equal(result.files[0].name, 'a.md');
  assert.equal(result.files[1].name, 'b.txt');
  assert.equal(result.metadata.totalFiles, 2);
  assert.match(result.content, /Alpha/);
  assert.match(result.content, /Beta/);
});

test('analyzeFilesFromPromptContext marks truncated files', () => {
  const result = analyzeFilesFromPromptContext('--- long.md ---\nabc\n[文件内容已截断，原始长度 99999 字符]');

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].truncated, true);
  assert.match(result.content, /Truncated: true/);
});

test('analyzeFilesFromPromptContext preserves unsupported file messages', () => {
  const result = analyzeFilesFromPromptContext('--- image.png ---\n[不支持直接读取此类型文件: image/png]');

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, 'image.png');
  assert.equal(result.files[0].unsupported, true);
  assert.match(result.content, /不支持直接读取此类型文件/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL because `src/server/tools/fileAnalysis.js` does not exist.

---

### Task 2: Implement File Analysis tool

**Files:**
- Create: `src/server/tools/fileAnalysis.js`
- Test: `test/fileAnalysis.test.js`

- [ ] **Step 1: Write minimal implementation**

Create `src/server/tools/fileAnalysis.js` with:

```js
const FILE_BLOCK_RE = /^---\s+(.+?)\s+---\n([\s\S]*?)(?=\n\n---\s+.+?\s+---\n|$)/gm;
const TRUNCATED_RE = /\[文件内容已截断，原始长度\s+(\d+)\s+字符\]/;
const UNSUPPORTED_RE = /\[不支持直接读取此类型文件:\s*([^\]]+)\]/;

function formatFileSection(file) {
  return [
    `File: ${file.name}`,
    `Truncated: ${file.truncated}`,
    file.unsupported ? `Unsupported: true` : null,
    '',
    file.content
  ].filter(line => line !== null).join('\n');
}

export function analyzeFilesFromPromptContext(context = '') {
  const source = String(context || '').trim();
  const files = [];

  if (!source) {
    return {
      tool: 'file_analysis',
      ok: true,
      content: '',
      files,
      metadata: { totalFiles: 0, totalChars: 0, skippedFiles: 0 }
    };
  }

  for (const match of source.matchAll(FILE_BLOCK_RE)) {
    const name = match[1].trim();
    const content = match[2].trim();
    const truncated = TRUNCATED_RE.test(content);
    const unsupported = UNSUPPORTED_RE.test(content);

    files.push({
      name,
      truncated,
      unsupported,
      textLength: content.length,
      content
    });
  }

  if (files.length === 0) {
    files.push({
      name: 'uploaded-content',
      truncated: TRUNCATED_RE.test(source),
      unsupported: UNSUPPORTED_RE.test(source),
      textLength: source.length,
      content: source
    });
  }

  const content = files.map(formatFileSection).join('\n\n');

  return {
    tool: 'file_analysis',
    ok: true,
    content,
    files: files.map(({ content, ...meta }) => meta),
    metadata: {
      totalFiles: files.length,
      totalChars: files.reduce((sum, file) => sum + file.textLength, 0),
      skippedFiles: files.filter(file => file.unsupported).length
    }
  };
}
```

- [ ] **Step 2: Run File Analysis tests**

Run:

```bash
node --test test/fileAnalysis.test.js
```

Expected: PASS.

- [ ] **Step 3: Run all tests**

Run:

```bash
npm test
```

Expected: PASS with the previous tests plus the new File Analysis tests.

---

### Task 3: Extend Prompt Builder for structured tool results

**Files:**
- Modify: `src/server/runtime/promptBuilder.js`
- Modify: `test/promptBuilder.test.js`

- [ ] **Step 1: Add failing prompt builder tests**

Append to `test/promptBuilder.test.js`:

```js
import { buildPrompt } from '../src/server/runtime/promptBuilder.js';

test('buildPrompt includes toolResults in stable order before user message', () => {
  const prompt = buildPrompt({
    toolInstructions: 'Tool instruction',
    webSearchResults: 'Search result',
    toolResults: [
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
```

If `test/promptBuilder.test.js` already imports `buildPrompt`, do not duplicate the import; only append the tests.

- [ ] **Step 2: Run prompt builder test to verify it fails**

Run:

```bash
node --test test/promptBuilder.test.js
```

Expected: FAIL because `buildPrompt()` does not support `toolResults` yet.

- [ ] **Step 3: Implement Prompt Builder support**

Replace `src/server/runtime/promptBuilder.js` with:

```js
const TOOL_SECTION_TITLES = {
  file_analysis: 'File Analysis',
  code_interpreter: 'Code Interpreter',
  web_search: 'Web Search Results'
};

function sectionTitleForTool(tool) {
  return TOOL_SECTION_TITLES[tool] || String(tool || 'Tool Result').replace(/_/g, ' ');
}

function appendToolResultSections(sections, toolResults = []) {
  for (const result of toolResults) {
    if (!result || !result.ok || !result.content || !String(result.content).trim()) continue;
    const title = sectionTitleForTool(result.tool);
    sections.push(`[${title}]\n${String(result.content).trim()}`);
  }
}

export function buildPrompt({ toolInstructions = '', webSearchResults = '', toolResults = [], userMessage = '' } = {}) {
  const sections = [];

  if (toolInstructions && toolInstructions.trim()) {
    sections.push(`[System Instructions]\nYou have the following tools available:\n${toolInstructions.trim()}`);
  }

  if (webSearchResults && webSearchResults.trim()) {
    sections.push(`[Web Search Results]\n${webSearchResults.trim()}`);
  }

  appendToolResultSections(sections, toolResults);

  sections.push(`[User Message]\n${String(userMessage || '').trim()}`);

  return sections.join('\n\n');
}
```

- [ ] **Step 4: Run prompt builder tests**

Run:

```bash
node --test test/promptBuilder.test.js
```

Expected: PASS.

---

### Task 4: Wire File Analysis into WebSocket prompt construction

**Files:**
- Modify: `src/server/index.js`

- [ ] **Step 1: Import File Analysis**

Modify the import section of `src/server/index.js` to include:

```js
import { analyzeFilesFromPromptContext } from './tools/fileAnalysis.js';
```

- [ ] **Step 2: Find prompt construction block**

Find the block where WebSocket input builds `prompt` using `getToolInstructions()`, `searchWeb()`, and `buildPrompt()`.

The block currently calls something equivalent to:

```js
prompt = buildPrompt({ toolInstructions, webSearchResults, userMessage: prompt });
```

- [ ] **Step 3: Add File Analysis tool result before buildPrompt**

Change the local logic to this shape:

```js
const toolResults = [];

if (tools.includes('file_analysis')) {
  const fileAnalysis = analyzeFilesFromPromptContext(prompt);
  if (fileAnalysis.content) toolResults.push(fileAnalysis);
}

prompt = buildPrompt({
  toolInstructions,
  webSearchResults,
  toolResults,
  userMessage: prompt
});
```

Keep existing Web Search behavior intact. Do not change the WebSocket message payload schema.

- [ ] **Step 4: Run diagnostics on `index.js`**

Use IDE diagnostics or run:

```bash
node --check src/server/index.js
```

Expected: no syntax errors.

---

### Task 5: Full validation

**Files:**
- All modified files

- [ ] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Search for duplicate or stale direct File Analysis logic**

Run code search for:

```text
File Analysis
analyzeFilesFromPromptContext
toolResults
```

Expected:
- `analyzeFilesFromPromptContext` exists in `fileAnalysis.js`, tests, and `index.js` only.
- `toolResults` exists in `promptBuilder.js`, tests, and `index.js` only.

- [ ] **Step 4: Manual smoke test**

Start the app:

```bash
npm start
```

In browser:
1. Connect model.
2. Open Tools & Skills.
3. Confirm File Analysis can be enabled.
4. Upload a Markdown file.
5. Send: `请总结这个文档`.
6. Confirm user message shows a file card, not raw file text.
7. Confirm assistant can summarize the file content.

- [ ] **Step 5: Commit**

Only after tests and build pass:

```bash
git add src/server/tools/fileAnalysis.js src/server/runtime/promptBuilder.js src/server/index.js test/fileAnalysis.test.js test/promptBuilder.test.js public/index.html public/assets
git commit -m "feat: add structured file analysis prompt context"
```

Do not force push.

---

## Self-Review

- Spec coverage: File Analysis module, unified tool result shape, Prompt Builder integration, WebSocket compatibility, and tests are covered.
- Placeholder scan: no TBD/TODO/implement-later placeholders remain.
- Type consistency: `tool`, `ok`, `content`, `files`, and `metadata` are consistent across tasks.
- Scope check: this plan does not include File API extraction, RAG, WebSocket protocol changes, or UI redesign.
