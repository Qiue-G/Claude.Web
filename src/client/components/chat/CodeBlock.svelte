<script>
  import Icon from '$components/common/Icon.svelte';
  import { t } from '$lib/i18n.js';
  import { sendBashCommand } from '$lib/websocket.js';
  import { highlightCode } from '$lib/shiki.js';

  export let code = '';
  export let language = '';

  let copied = false;
  let lineCount = 0;
  let highlightedHtml = '';  // shiki-generated HTML
  let loading = true;        // true until first highlight completes

  // On mount and when code changes, highlight asynchronously
  $: if (code) {
    lineCount = code.split('\n').length;
    highlightAsync(code, language);
  } else {
    highlightedHtml = '';
    lineCount = 0;
  }

  let highlightCounter = 0;
  async function highlightAsync(c, lang) {
    const ticket = ++highlightCounter;
    // Show loading state only on first render (not during streaming updates)
    if (!highlightedHtml) loading = true;
    try {
      const html = await highlightCode(c, lang);
      // Only apply if this is still the latest request
      if (ticket === highlightCounter) {
        highlightedHtml = html;
        loading = false;
      }
    } catch (e) {
      if (ticket === highlightCounter) {
        highlightedHtml = '';
        loading = false;
      }
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

  // Bash 命令执行
  let executing = false;
  const isExecutable = ['bash', 'sh', 'shell'].includes(language);

  async function executeCommand() {
    if (executing) return;
    executing = true;
    sendBashCommand(code);
  }
</script>

<div class="code-block">
  <div class="code-block-hdr">
    <span class="code-lang">{displayLang}{#if lineCount > 0}<span class="code-lines">{$t('code.lines', { n: lineCount })}</span>{/if}</span>
    <div class="hdr-actions">
      {#if isExecutable}
        <button class="run-btn" class:running={executing} on:click={executeCommand} disabled={executing}>
          <Icon name="play" size="sm" />
          {executing ? $t('common.running') : $t('code.run')}
        </button>
      {/if}
      <button class="copy-btn" class:copied on:click={copyCode}>
        <Icon name="copy" size="sm" />
        {copied ? $t('common.copied') : $t('common.copy')}
      </button>
    </div>
  </div>
  {#if highlightedHtml && !loading}
    {@html highlightedHtml}
  {:else}
    <pre><code>{code}</code></pre>
  {/if}
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

  .hdr-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .copy-btn, .run-btn {
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

  .run-btn:hover { background: var(--bg-hover); color: var(--green); }
  .run-btn.running { color: var(--amber); cursor: not-allowed; }
  .run-btn:disabled { opacity: 0.6; }

  .code-lang { display: flex; align-items: center; gap: 8px; }
  .code-lines { color: var(--text-muted); font-size: 10px; }

  /* Shiki-generated <pre> styling */
  :global(.code-block pre.shiki) {
    margin: 0;
    padding: 12px 16px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    background: transparent !important;
  }

  :global(.code-block pre.shiki code) {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
  }

  /* Fallback pre styling (when shiki isn't ready) */
  pre {
    margin: 0;
    padding: 12px 16px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
  }
</style>
