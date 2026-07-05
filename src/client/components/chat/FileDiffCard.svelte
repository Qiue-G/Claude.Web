<script>
  import { createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { sessionToken } from '$stores/session.store.js';
  import { t } from '$lib/i18n.js';

  $: _t = $t;

  export let diff = null;
  export let sessionId = '';

  const dispatch = createEventDispatcher();

  let reverting = false;
  let reverted = false;
  let revertError = '';

  async function handleRevert() {
    if (!diff || reverted) return;
    reverting = true;
    revertError = '';
    try {
      const token = get(sessionToken);
      // POST /api/session/{sessionId}/rollback/{versionId}/{filePath}
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
</script>

<div class="file-diff-card">
  <div class="diff-header">
    <span class="diff-file">{diff.filePath}</span>
    {#if diff.summary}
      <span class="diff-summary">{diff.summary}</span>
    {/if}
  </div>
  <div class="diff-body">
    {#if diff.changes?.length}
      {#each diff.changes as change}
        {#if change.added}
          <div class="diff-line added">
            <span class="line-prefix">+</span>
            <span class="line-content">{change.value}</span>
          </div>
        {:else if change.removed}
          <div class="diff-line removed">
            <span class="line-prefix">-</span>
            <span class="line-content">{change.value}</span>
          </div>
        {/if}
      {/each}
    {:else}
      <div class="diff-empty">无差异</div>
    {/if}
  </div>
  <div class="diff-actions">
    <button class="btn btn-outline" onclick={handleOpen}>
      在编辑器中打开
    </button>
    <button class="btn btn-outline btn-danger" onclick={handleRevert} disabled={reverting || reverted}>
      {reverted ? '已回滚' : reverting ? '回滚中...' : '回滚此更改'}
    </button>
    {#if revertError}
      <span class="error-msg">{revertError}</span>
    {/if}
  </div>
</div>

<style>
  .file-diff-card {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-raised);
    margin: 8px 0;
    overflow: hidden;
  }

  .diff-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }

  .diff-file {
    font-family: monospace;
    color: var(--accent);
    font-weight: 600;
  }

  .diff-summary {
    color: var(--text-dim);
    font-size: 11px;
  }

  .diff-body {
    max-height: 300px;
    overflow-y: auto;
    font-family: monospace;
    font-size: 12px;
    line-height: 1.5;
  }

  .diff-line {
    display: flex;
    padding: 0 12px;
    min-height: 20px;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .diff-line.added {
    background: rgba(34, 197, 94, 0.1);
  }

  .diff-line.removed {
    background: rgba(239, 68, 68, 0.1);
  }

  .line-prefix {
    width: 16px;
    flex-shrink: 0;
    text-align: center;
    user-select: none;
  }

  .diff-line.added .line-prefix {
    color: #22c55e;
  }

  .diff-line.removed .line-prefix {
    color: #ef4444;
  }

  .line-content {
    white-space: pre-wrap;
    word-break: break-all;
  }

  .diff-empty {
    padding: 16px;
    text-align: center;
    color: var(--text-dim);
    font-size: 12px;
  }

  .diff-actions {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
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
</style>
