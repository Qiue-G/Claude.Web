# Tool Result 格式统一实施计划

> **For agentic workers:** 按 Task 分步执行，每个任务先写测试，再实现，再验证。

**Goal:** 将 webSearch 和 codeInterpreter 的输出格式统一为 ToolResult 结构，所有工具结果均通过 `toolResults` 数组注入 Prompt Builder，移除 `webSearchResults` 独立参数。

**Architecture:** 不改变 WebSocket 协议，不改 UI，不跑大重构。只改：
1. webSearch 返回 ToolResult
2. codeInterpreter 返回 ToolResult  
3. promptBuilder 移除 webSearchResults 参数
4. index.js 统一使用 toolResults

**Tech Stack:** Node.js ES modules, Express, `node:test`

---

## 文件结构

- Modify: `src/server/tools/webSearch.js` — 返回 ToolResult
- Modify: `src/server/tools/codeInterpreter.js` — 返回 ToolResult
- Modify: `src/server/runtime/promptBuilder.js` — 移除 webSearchResults，全走 toolResults
- Modify: `src/server/index.js` — 统一用 toolResults
- Modify: `test/tools.test.js` — 验证 webSearch ToolResult
- Create: `test/codeInterpreter.test.js` — 验证 codeInterpreter ToolResult

---

### Task 1: webSearch 返回 ToolResult

**Files:**
- Modify: `src/server/tools/webSearch.js`
- Modify: `test/tools.test.js`

- [ ] **Step 1: Add failing test**

在 `test/tools.test.js` 追加：

```js
test('webSearch returns ToolResult format', async () => {
  const { searchWeb } = await import('../src/server/tools/webSearch.js');
  const mockFetch = async () => ({
    json: async () => ({
      AbstractText: 'JavaScript is a programming language',
      AbstractURL: 'https://en.wikipedia.org/wiki/JavaScript',
      RelatedTopics: []
    })
  });
  const result = await searchWeb('JavaScript', mockFetch);
  assert.equal(result.tool, 'web_search');
  assert.equal(result.ok, true);
  assert.match(result.content, /JavaScript/);
  assert.ok(Array.isArray(result.sources));
  assert.ok(result.metadata);
});
```

Run to confirm it fails.

- [ ] **Step 2: Modify webSearch to return ToolResult**

```js
const MAX_RESULTS = 5;

export async function searchWeb(query, fetchImpl = fetch) {
  try {
    const apiRes = await fetchImpl(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(String(query || '').substring(0, 200))}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'FreeCode/1.0' }, signal: AbortSignal.timeout(8000) }
    );
    const data = await apiRes.json();
    const sources = [];
    const parts = [];

    if (data.AbstractText) {
      parts.push(`摘要: ${data.AbstractText}${data.AbstractURL ? '\n来源: ' + data.AbstractURL : ''}`);
      if (data.AbstractURL) sources.push({ title: data.AbstractText.substring(0, 80), url: data.AbstractURL });
    }
    if (data.Answer) parts.push(`答案: ${data.Answer}`);

    if (Array.isArray(data.RelatedTopics)) {
      const results = data.RelatedTopics
        .flatMap(topic => Array.isArray(topic.Topics) ? topic.Topics : [topic])
        .filter(topic => topic.Text && topic.FirstURL)
        .slice(0, MAX_RESULTS);

      if (results.length > 0) {
        parts.push('搜索结果:');
        results.forEach((result, index) => {
          parts.push(`${index + 1}. ${result.Text} — ${result.FirstURL}`);
          sources.push({ title: result.Text.substring(0, 80), url: result.FirstURL });
        });
      }
    }

    const content = parts.length > 0 ? parts.join('\n') : `未找到 "${query}" 的相关结果`;
    return { tool: 'web_search', ok: true, content, sources, metadata: { query, resultCount: sources.length } };
  } catch (e) {
    console.error('[SEARCH] Error:', e.message);
    return { tool: 'web_search', ok: false, content: `[搜索失败: ${e.message}]`, sources: [], metadata: { query, error: e.message } };
  }
}
```

- [ ] **Step 3: Run tests**

Run: `node --test test/tools.test.js` (include the new test)
Expected: PASS

---

### Task 2: codeInterpreter 返回 ToolResult

**Files:**
- Create: `test/codeInterpreter.test.js`
- Modify: `src/server/tools/codeInterpreter.js`

- [ ] **Step 1: Add failing test**

新增 `test/codeInterpreter.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { executePython, extractPythonBlocks, codeInterpreterResult } from '../src/server/tools/codeInterpreter.js';

test('codeInterpreterResult formats ToolResult', () => {
  const result = codeInterpreterResult('print("hello")', { stdout: 'hello\n', stderr: '', exitCode: 0 });
  assert.equal(result.tool, 'code_interpreter');
  assert.equal(result.ok, true);
  assert.match(result.content, /hello/);
});

test('codeInterpreterResult marks error on non-zero exit', () => {
  const result = codeInterpreterResult('invalid code', { stdout: '', stderr: 'SyntaxError', exitCode: 1 });
  assert.equal(result.ok, false);
  assert.match(result.content, /SyntaxError/);
});
```

Run to confirm fail.

- [ ] **Step 2: Modify codeInterpreter to export ToolResult helper**

在 `src/server/tools/codeInterpreter.js` 追加：

```js
export function codeInterpreterResult(code, { stdout, stderr, exitCode }) {
  const content = [];
  if (stdout) content.push(`[输出]\n${stdout.trim()}`);
  if (stderr) content.push(`[错误]\n${stderr.trim()}`);
  const text = content.join('\n\n') || '无输出';
  return {
    tool: 'code_interpreter',
    ok: exitCode === 0,
    content: text,
    metadata: { exitCode, codeLength: code.length, outputLength: text.length }
  };
}
```

- [ ] **Step 3: Run tests**

Run: `node --test test/codeInterpreter.test.js`
Expected: PASS

---

### Task 3: promptBuilder 移除 webSearchResults

**Files:**
- Modify: `src/server/runtime/promptBuilder.js`
- Modify: `test/promptBuilder.test.js`

- [ ] **Step 1: Add failing tests**

在 `test/promptBuilder.test.js` 追加：

```js
test('buildPrompt without webSearchResults still works via toolResults', () => {
  const prompt = buildPrompt({
    toolResults: [{ tool: 'web_search', ok: true, content: 'Search results here' }],
    userMessage: 'Hi'
  });
  assert.match(prompt, /\[Web Search Results\]\nSearch results here/);
  assert.match(prompt, /\[User Message\]\nHi/);
});
```

Run to confirm fail (current buildPrompt still has webSearchResults param).

- [ ] **Step 2: Modify promptBuilder**

移除 `webSearchResults` 参数和独立处理。`web_search` 和其他工具一样走 `toolResults`。

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

export function buildPrompt({ toolInstructions = '', toolResults = [], userMessage = '' } = {}) {
  const sections = [];

  if (toolInstructions && toolInstructions.trim()) {
    sections.push(`[System Instructions]\nYou have the following tools available:\n${toolInstructions.trim()}`);
  }

  appendToolResultSections(sections, toolResults);

  sections.push(`[User Message]\n${String(userMessage || '').trim()}`);

  return sections.join('\n\n');
}
```

- [ ] **Step 3: Update tests**

The existing test `buildPrompt keeps stable sections and appends user message last` uses `webSearchResults`, update it to use `toolResults`:

```js
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
```

- [ ] **Step 4: Run tests**

Run: `node --test test/promptBuilder.test.js`
Expected: PASS

---

### Task 4: index.js 统一 toolResults

**Files:**
- Modify: `src/server/index.js`

- [ ] **Step 1: Remove webSearchResults variable**

修改 `index.js` prompt 构建块：

```js
        const tools = (typeof message.data === 'object' ? message.data.tools : null) || [];
        const toolResults = [];
        let userMessageForPrompt = originalPrompt;

        if (tools.includes('web_search') && originalPrompt && originalPrompt.trim()) {
          broadcastToSession(sessionId, { type: 'output', data: '\n[正在搜索...]\n' });
          const result = await searchWeb(originalPrompt);
          if (result.content) toolResults.push(result);
          console.log('[WEB_SEARCH] results length: ' + result.content.length + ' chars');
        }

        if (tools.includes('file_analysis') && originalPrompt && originalPrompt.trim()) {
          const fileAnalysis = analyzeFilesFromPromptContext(originalPrompt);
          if (fileAnalysis.content) {
            toolResults.push(fileAnalysis);
            userMessageForPrompt = stripFileBlocksFromPrompt(originalPrompt);
          }
        }

        prompt = buildPrompt({
          toolInstructions: getToolInstructions(tools),
          toolResults,
          userMessage: userMessageForPrompt
        });
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/server/index.js`
Expected: no errors

---

### Task 5: 全量验证

- [ ] **Step 1: Run all tests**

```bash
npm test
```
Expected: PASS

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: PASS

- [ ] **Step 3: Search for stale references**

搜索 `webSearchResults`。确认只在以下位置出现：
- `src/server/index.js` (如果有残留)
- `test/promptBuilder.test.js` (如果有残留)
- 其他不应该出现

- [ ] **Step 4: 提交流程**

```bash
git add -A
git commit -m "refactor: 统一 Tool Result 格式，移除 webSearchResults 独立参数"
git push
```
