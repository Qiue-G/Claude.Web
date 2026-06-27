<script>
  import EditorTabs from './EditorTabs.svelte';
  import { fileContents, activeTab, currentFile, currentFileContent } from '$stores/files.store.js';
  import { createEventDispatcher, tick } from 'svelte';
  import { t } from '$lib/i18n.js';

  const dispatch = createEventDispatcher();

  let textarea;
  let gutter;
  let scrollContainer;
  let content = '';

  $: if ($activeTab) {
    content = $fileContents[$activeTab] || '';
  } else {
    content = '';
  }
  $: lineCount = content === '' ? 0 : content.split('\n').length;

  function handleInput() {
    if ($activeTab) {
      dispatch('change', { path: $activeTab, content });
    }
  }

  function handleKeydown(e) {
    // Tab 键插入制表符
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.substring(0, start) + '\t' + content.substring(end);
      content = newContent;
      handleInput();
      tick().then(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1;
      });
    }
    // Shift+Tab 移除前导缩进
    else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const start = textarea.selectionStart;
      const lineStart = content.lastIndexOf('\n', start - 1) + 1;
      const beforeLine = content.substring(0, lineStart);
      const currentLine = content.substring(lineStart, start);
      let newLine;
      if (currentLine.startsWith('\t')) {
        newLine = currentLine.substring(1);
      } else if (currentLine.startsWith('  ')) {
        newLine = currentLine.substring(2);
      } else {
        newLine = currentLine;
      }
      content = beforeLine + newLine + content.substring(start);
      handleInput();
      tick().then(() => {
        const diff = currentLine.length - newLine.length;
        textarea.selectionStart = textarea.selectionEnd = start - diff;
      });
    }
    // Ctrl/Cmd+S 保存
    else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if ($activeTab) {
        dispatch('save', $activeTab);
      }
    }
  }

  // 同步滚动：textarea 滚动时同步到 gutter
  function handleScroll() {
    if (gutter && textarea) {
      gutter.scrollTop = textarea.scrollTop;
    }
  }
</script>

<div class="editor-panel">
  <EditorTabs
    on:tabSelect={(e) => dispatch('tabSelect', e.detail)}
    on:tabClose={(e) => dispatch('tabClose', e.detail)}
  />

  {#if $activeTab}
    <div class="editor-toolbar">
      <span class="et-info">{$activeTab}</span>
      <div class="et-actions">
        <button class="et-btn" on:click={() => dispatch('save', $activeTab)}>{$t('editor.save')}</button>
      </div>
    </div>
    <div class="editor-body">
      <div class="editor-scroll" bind:this={scrollContainer}>
        <div class="editor-gutter" bind:this={gutter}>
          {#each Array(lineCount) as _, i}
            <div class="line-number">{i + 1}</div>
          {/each}
        </div>
        <textarea
          bind:this={textarea}
          class="editor-textarea"
          value={content}
          on:input={handleInput}
          on:keydown={handleKeydown}
          on:scroll={handleScroll}
          spellcheck="false"
        ></textarea>
      </div>
    </div>
  {:else}
    <div class="editor-empty">
      <span class="ee-icon">&#128196;</span>
      <span class="ee-text">{$t('editor.noFile')}</span>
    </div>
  {/if}
</div>

<style>
  .editor-panel {
    display: flex;
    flex-direction: column;
    background: var(--bg-base);
    overflow: hidden;
    flex: 1;
  }

  .editor-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    background: var(--bg-toolbar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 28px;
  }

  .et-info {
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .et-actions {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }

  .et-btn {
    padding: 3px 10px;
    font-size: 11px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: var(--font-sans);
  }

  .et-btn:hover {
    background: var(--bg-accent-dim);
    color: var(--amber-bright);
    border-color: var(--border-hover);
  }

  .editor-body {
    flex: 1;
    overflow: hidden;
    position: relative;
    min-height: 0;
  }

  .editor-scroll {
    display: flex;
    height: 100%;
    overflow: auto;
    align-items: flex-start;
  }

  .editor-gutter {
    padding: 8px 8px 8px 12px;
    background: var(--bg-base);
    user-select: none;
    flex-shrink: 0;
    min-width: 40px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .line-number {
    text-align: right;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-dim);
    height: 20.8px; /* 13px * 1.6 */
    flex-shrink: 0;
  }

  .editor-textarea {
    flex: 1;
    padding: 8px 12px;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre;
    overflow: visible;
    tab-size: 2;
    caret-color: var(--amber);
    min-height: 100%;
  }

  .editor-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-dim);
    gap: 8px;
    flex: 1;
  }

  .ee-icon { opacity: 0.3; font-size: 24px; }
  .ee-text { font-size: 13px; }
</style>
