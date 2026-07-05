<script>
  import { createEventDispatcher, afterUpdate } from 'svelte';
  import { get } from 'svelte/store';
  import { sessionToken } from '$stores/session.store.js';
  import { scrollToLine } from '$stores/files.store.js';
  import { t } from '$lib/i18n.js';

  $: _t = $t;

  export let diff = null;
  export let sessionId = '';
  // 多文件导航上下文
  export let index = 0;
  export let total = 1;
  export let onprev = null;
  export let onnext = null;

  const dispatch = createEventDispatcher();

  let reverting = false;
  let reverted = false;
  let revertError = '';

  // 展开/折叠
  let collapsed = false;
  let _expanded = true;

  // 自动折叠阈值：超过此行数则默认折叠
  const AUTO_COLLAPSE_THRESHOLD = 15;
  let totalLines = 0;

  $: {
    if (diff?.changes) {
      totalLines = diff.changes.length;
      // 大 diff 默认折叠
      if (totalLines > AUTO_COLLAPSE_THRESHOLD) {
        _expanded = false;
        collapsed = true;
      } else {
        _expanded = true;
        collapsed = false;
      }
    }
  }

  function toggleExpand() {
    _expanded = !_expanded;
  }

  async function handleRevert() {
    if (!diff || reverted) return;
    reverting = true;
    revertError = '';
    try {
      const token = get(sessionToken);
      const url = `/api/session/${sessionId}/rollback/${diff.fromVersion}/${diff.filePath}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-session-token': token,
          'x-csrf-token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
        }
      });
      if (!res.ok) throw new Error(`Rollback failed: ${res.statusText}`);
      reverted = true;
      dispatch('reverted', { filePath: diff.filePath });
    } catch (e) {
      revertError = e.message;
    } finally {
      reverting = false;
    }
  }

  function handleOpen() {
    dispatch('open', { filePath: diff.filePath });
  }

  function jumpToFile(line) {
    if (line) {
      scrollToLine.set({ filePath: diff.filePath, line });
      dispatch('open', { filePath: diff.filePath });
    } else {
      handleOpen();
    }
  }

  function getFileIcon(filePath) {
    const ext = filePath?.split('.').pop()?.toLowerCase();
    const iconMap = {
      js: '🟨', jsx: '⚛️', ts: '🔵', tsx: '⚛️',
      py: '🐍', rs: '🦀', go: '🔷', java: '☕',
      css: '🎨', scss: '🎨', html: '🌐', svelte: '🧩',
      json: '📋', yml: '⚙️', yaml: '⚙️', toml: '⚙️',
      md: '📝', txt: '📄', xml: '📰',
      vue: '💚', sfc: '💚',
    };
    return iconMap[ext] || '📄';
  }

  // 统计增删行数
  let addedCount = 0;
  let removedCount = 0;
  $: {
    addedCount = 0;
    removedCount = 0;
    if (diff?.changes) {
      for (const c of diff.changes) {
        if (c.added) addedCount++;
        else if (c.removed) removedCount++;
      }
    }
  }
</script>

<div class="file-diff-card" class:collapsed={!_expanded}>
  <div class="diff-header" onclick={toggleExpand} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && toggleExpand()}>
    <div class="diff-header-left">
      <span class="diff-toggle">{_expanded ? '▼' : '▶'}</span>
      <span class="diff-file-icon">{getFileIcon(diff?.filePath)}</span>
      <span class="diff-file">{diff?.filePath}</span>
      <span class="diff-stats">
        {#if removedCount > 0}<span class="stat-removed">-{removedCount}</span>{/if}
        {#if addedCount > 0}<span class="stat-added">+{addedCount}</span>{/if}
      </span>
    </div>
    <div class="diff-header-right">
      {#if diff?.summary}
        <span class="diff-summary">{diff.summary}</span>
      {/if}
      <span class="diff-line-count">{totalLines} lines</span>
    </div>
  </div>

  <div class="diff-body-wrapper" class:expanded={_expanded} class:collapsed={!_expanded}>
    <div class="diff-body">
      {#if diff?.changes?.length}
        {#each diff.changes as change}
          {#if change.removed}
            <div class="diff-line removed" onclick={() => change.oldStartLine && jumpToFile(change.oldStartLine)} role="button" tabindex="-1" title="跳转到第 {change.oldStartLine} 行">
              <span class="line-num">{change.oldStartLine}</span>
              <span class="line-num-sep">-</span>
              <span class="line-prefix">-</span>
              <span class="line-content">{change.value}</span>
            </div>
          {:else if change.added}
            <div class="diff-line added" onclick={() => change.startLine && jumpToFile(change.startLine)} role="button" tabindex="-1" title="跳转到第 {change.startLine} 行">
              <span class="line-num">{change.startLine}</span>
              <span class="line-num-sep">+</span>
              <span class="line-prefix">+</span>
              <span class="line-content">{change.value}</span>
            </div>
          {:else}
            <div class="diff-line context" onclick={() => change.startLine && jumpToFile(change.startLine)} role="button" tabindex="-1" title="跳转到第 {change.startLine} 行">
              <span class="line-num">{change.startLine}</span>
              <span class="line-num-sep"></span>
              <span class="line-prefix"></span>
              <span class="line-content">{change.value}</span>
            </div>
          {/if}
        {/each}
      {:else}
        <div class="diff-empty">无差异</div>
      {/if}
    </div>
  </div>

  <div class="diff-footer">
    <div class="diff-actions">
      <button class="btn btn-outline" onclick={handleOpen}>
        在编辑器中打开
      </button>
      <button class="btn btn-outline btn-danger" onclick={handleRevert} disabled={reverting || reverted || !diff?.fromVersion}>
        {!diff?.fromVersion ? '新文件无法回滚' : reverted ? '已回滚' : reverting ? '回滚中...' : '回滚此更改'}
      </button>
      {#if revertError}
        <span class="error-msg">{revertError}</span>
      {/if}
    </div>

    {#if total > 1}
      <div class="diff-nav">
        <button class="nav-btn" onclick={onprev} disabled={index <= 0} title="上一个文件变更">
          ▲
        </button>
        <span class="nav-index">{index + 1} / {total}</span>
        <button class="nav-btn" onclick={onnext} disabled={index >= total - 1} title="下一个文件变更">
          ▼
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .file-diff-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-raised);
    margin: 8px 0;
    overflow: hidden;
    transition: box-shadow 0.15s;
  }

  .file-diff-card:hover {
    box-shadow: 0 1px 6px rgba(0,0,0,0.15);
  }

  .diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
    transition: background 0.1s;
    gap: 8px;
  }

  .diff-header:hover {
    background: rgba(255,255,255,0.03);
  }

  .diff-header-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }

  .diff-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .diff-toggle {
    font-size: 9px;
    color: var(--text-dim);
    width: 12px;
    text-align: center;
    flex-shrink: 0;
  }

  .diff-file-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .diff-file {
    font-family: monospace;
    color: var(--accent);
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff-stats {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .stat-removed {
    font-size: 11px;
    font-weight: 700;
    color: #ef4444;
  }

  .stat-added {
    font-size: 11px;
    font-weight: 700;
    color: #22c55e;
  }

  .diff-summary {
    color: var(--text-dim);
    font-size: 11px;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff-line-count {
    font-size: 11px;
    color: var(--text-dim);
    font-family: monospace;
    flex-shrink: 0;
  }

  /* ===== Collapse/Expand ===== */
  .diff-body-wrapper {
    overflow: hidden;
    transition: max-height 0.25s ease, opacity 0.2s ease;
  }

  .diff-body-wrapper.expanded {
    max-height: 2000px;
    opacity: 1;
  }

  .diff-body-wrapper.collapsed {
    max-height: 0;
    opacity: 0;
  }

  .diff-body {
    max-height: 400px;
    overflow-y: auto;
    font-family: monospace;
    font-size: 12px;
    line-height: 1.5;
    border-top: 1px solid var(--border);
  }

  .diff-line {
    display: flex;
    padding: 0 4px 0 8px;
    min-height: 20px;
    white-space: pre-wrap;
    word-break: break-all;
    cursor: pointer;
    transition: background 0.08s;
    border-left: 3px solid transparent;
  }

  /* ===== Color Improvements - Higher Contrast ===== */
  .diff-line.added {
    background: rgba(34, 197, 94, 0.18);
    border-left-color: #22c55e;
  }

  .diff-line.added:hover {
    background: rgba(34, 197, 94, 0.28);
  }

  .diff-line.removed {
    background: rgba(239, 68, 68, 0.15);
    border-left-color: #ef4444;
  }

  .diff-line.removed:hover {
    background: rgba(239, 68, 68, 0.25);
  }

  .diff-line.context {
    background: transparent;
    opacity: 0.75;
    border-left-color: transparent;
  }

  .diff-line.context:hover {
    background: rgba(255, 255, 255, 0.03);
    opacity: 0.9;
  }

  .line-num {
    width: 32px;
    flex-shrink: 0;
    text-align: right;
    color: var(--text-dim);
    font-size: 11px;
    padding-right: 4px;
    user-select: none;
  }

  .line-num-sep {
    width: 12px;
    flex-shrink: 0;
    text-align: center;
    color: var(--text-dim);
    font-size: 11px;
    user-select: none;
  }

  .line-prefix {
    width: 14px;
    flex-shrink: 0;
    text-align: center;
    font-weight: bold;
    user-select: none;
  }

  .diff-line.added .line-prefix,
  .diff-line.added .line-num-sep {
    color: #22c55e;
    font-weight: 700;
  }

  .diff-line.removed .line-prefix,
  .diff-line.removed .line-num-sep {
    color: #ef4444;
    font-weight: 700;
  }

  .line-content {
    white-space: pre-wrap;
    word-break: break-all;
    flex: 1;
    opacity: 0.9;
  }

  .diff-empty {
    padding: 16px;
    text-align: center;
    color: var(--text-dim);
    font-size: 12px;
  }

  /* ===== Footer ===== */
  .diff-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    gap: 8px;
  }

  .diff-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .btn {
    padding: 4px 12px;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg-base);
    color: var(--text-secondary);
    transition: all 0.15s;
  }

  .btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-danger:hover {
    border-color: #ef4444;
    color: #ef4444;
  }

  .error-msg {
    color: #ef4444;
    font-size: 11px;
  }

  /* ===== Navigation ===== */
  .diff-nav {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .nav-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-base);
    color: var(--text-secondary);
    font-size: 10px;
    cursor: pointer;
    transition: all 0.15s;
    padding: 0;
    line-height: 1;
  }

  .nav-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }

  .nav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .nav-index {
    font-size: 11px;
    color: var(--text-dim);
    font-family: monospace;
    min-width: 36px;
    text-align: center;
  }
</style>
