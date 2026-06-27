<script>
  import Icon from '$components/common/Icon.svelte';
  import hljs from 'highlight.js/lib/core';
  import { t } from '$lib/i18n.js';
  
  // 注册常用语言
  import javascript from 'highlight.js/lib/languages/javascript';
  import typescript from 'highlight.js/lib/languages/typescript';
  import python from 'highlight.js/lib/languages/python';
  import java from 'highlight.js/lib/languages/java';
  import cpp from 'highlight.js/lib/languages/cpp';
  import csharp from 'highlight.js/lib/languages/csharp';
  import go from 'highlight.js/lib/languages/go';
  import rust from 'highlight.js/lib/languages/rust';
  import php from 'highlight.js/lib/languages/php';
  import ruby from 'highlight.js/lib/languages/ruby';
  import swift from 'highlight.js/lib/languages/swift';
  import kotlin from 'highlight.js/lib/languages/kotlin';
  import sql from 'highlight.js/lib/languages/sql';
  import bash from 'highlight.js/lib/languages/bash';
  import json from 'highlight.js/lib/languages/json';
  import xml from 'highlight.js/lib/languages/xml';
  import css from 'highlight.js/lib/languages/css';
  import markdown from 'highlight.js/lib/languages/markdown';
  import yaml from 'highlight.js/lib/languages/yaml';
  import dockerfile from 'highlight.js/lib/languages/dockerfile';

  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('js', javascript);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('ts', typescript);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('py', python);
  hljs.registerLanguage('java', java);
  hljs.registerLanguage('cpp', cpp);
  hljs.registerLanguage('c', cpp);
  hljs.registerLanguage('csharp', csharp);
  hljs.registerLanguage('cs', csharp);
  hljs.registerLanguage('go', go);
  hljs.registerLanguage('rust', rust);
  hljs.registerLanguage('php', php);
  hljs.registerLanguage('ruby', ruby);
  hljs.registerLanguage('rb', ruby);
  hljs.registerLanguage('swift', swift);
  hljs.registerLanguage('kotlin', kotlin);
  hljs.registerLanguage('kt', kotlin);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('sh', bash);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('html', xml);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('markdown', markdown);
  hljs.registerLanguage('md', markdown);
  hljs.registerLanguage('yaml', yaml);
  hljs.registerLanguage('yml', yaml);
  hljs.registerLanguage('dockerfile', dockerfile);

  export let code = '';
  export let language = '';

  let copied = false;
  let lineCount = 0;
  let highlightedCode = '';

  $: {
    if (code) {
      lineCount = code.split('\n').length;
      try {
        if (language && hljs.getLanguage(language)) {
          highlightedCode = hljs.highlight(code, { language }).value;
        } else {
          highlightedCode = hljs.highlightAuto(code).value;
        }
      } catch (e) {
        highlightedCode = code;
      }
    } else {
      highlightedCode = '';
      lineCount = 0;
    }
  }

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => copied = false, 2000);
  }

  const langMap = {
    js: 'JavaScript', ts: 'TypeScript', py: 'Python', java: 'Java',
    cpp: 'C++', c: 'C', cs: 'C#', go: 'Go', rs: 'Rust',
    php: 'PHP', rb: 'Ruby', swift: 'Swift', kt: 'Kotlin',
    sql: 'SQL', sh: 'Shell', bash: 'Bash', json: 'JSON',
    xml: 'XML', html: 'HTML', css: 'CSS', md: 'Markdown',
    yml: 'YAML', yaml: 'YAML', dockerfile: 'Dockerfile'
  };

  let displayLang = '';
  $: displayLang = langMap[language] || language || 'code';
</script>

<div class="code-block">
  <div class="code-block-hdr">
    <span class="code-lang">{displayLang}{#if lineCount > 0}<span class="code-lines">{lineCount} 行</span>{/if}</span>
    <button class="copy-btn" class:copied on:click={copyCode}>
      <Icon name="copy" size="sm" />
      {copied ? $t('common.copied') : $t('common.copy')}
    </button>
  </div>
  <pre><code>{@html highlightedCode}</code></pre>
</div>

<style>
  .code-block {
    margin: 10px 0;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--bg-code);
  }

  .code-block-hdr {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .copy-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    transition: all 0.15s;
  }

  .copy-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .copy-btn.copied { color: var(--green); }

  .code-lang { display: flex; align-items: center; gap: 8px; }
  .code-lines { color: var(--text-muted); font-size: 10px; }

  pre {
    margin: 0;
    padding: 12px 16px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
  }

  /* highlight.js 主题 - 响应主题切换 */
  :global(.hljs) {
    color: var(--text-primary);
  }
  :global(.hljs-keyword),
  :global(.hljs-selector-tag),
  :global(.hljs-title),
  :global(.hljs-section) {
    color: var(--amber-bright);
  }
  :global(.hljs-string),
  :global(.hljs-attr) {
    color: var(--green);
  }
  :global(.hljs-number),
  :global(.hljs-literal),
  :global(.hljs-symbol) {
    color: var(--cyan);
  }
  :global(.hljs-comment),
  :global(.hljs-quote) {
    color: var(--text-dim);
    font-style: italic;
  }
  :global(.hljs-function),
  :global(.hljs-built_in) {
    color: var(--blue);
  }
  :global(.hljs-class) {
    color: var(--amber);
  }
  :global(.hljs-variable),
  :global(.hljs-template-variable) {
    color: var(--red);
  }
  :global(.hljs-tag),
  :global(.hljs-name) {
    color: var(--red);
  }
  :global(.hljs-type),
  :global(.hljs-params) {
    color: var(--cyan);
  }
</style>
