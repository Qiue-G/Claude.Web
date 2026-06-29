<script>
  import { createEventDispatcher, get } from 'svelte';
  import { sessionId, sessionToken } from '$stores/session.store.js';
  import { getDiff } from '$apis/files.api.js';
  import { t } from '$lib/i18n.js';

  const dispatch = createEventDispatcher();

  let { fromId = '', toId = '', filePath = '' } = $props();

  let changes = $state([]);
  let loading = $state(false);
  let error = $state('');
  let fromTime = $state(null);
  let toTime = $state(null);

  // Automatically load diff when both version IDs are set
  $effect(() => {
    if (fromId && toId) {
      loadDiff();
    } else {
      changes = [];
      fromTime = null;
      toTime = null;
    }
  });

  async function loadDiff() {
    if (!fromId || !toId) return;
    loading = true;
    error = '';
    try {
      const sid = get(sessionId);
      const tok = get(sessionToken);
      if (!sid || !tok) return;
      const result = await getDiff(sid, fromId, toId, tok);
      changes = result.changes || [];
      fromTime = result.fromTime;
      toTime = result.toTime;
    } catch (e) {
      error = e.message || 'Failed to load diff';
      changes = [];
    } finally {
      loading = false;
    }
  }

  function formatDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString();
  }

  function closeDiff() {
    dispatch('close');
  }
</script>

<div class="diff-viewer">
  <div class="diff-header">
    <span class="diff-title">{$t('files.diffView')}</span>
    <div class="diff-info">
      {#if filePath}
        <span class="diff-file">{filePath}</span>
      {/if}
      {#if fromTime}
        <span class="diff-time">{formatDate(fromTime)} → {formatDate(toTime)}</span>
      {/if}
    </div>
    <button class="close-btn" onclick={closeDiff} title="关闭 diff">×</button>
  </div>

  <div class="diff-body">
    {#if loading}
      <div class="diff-loading">{$t('common.loading')}...</div>
    {:else if error}
      <div class="diff-error">{error}</div>
    {:else if changes.length === 0}
      <div class="diff-empty">无差异（内容相同）</div>
    {:else}
      <div class="diff-stats">
        <span class="stat-added">+{changes.filter(c => c.added).reduce((s, c) => s + (c.count || 0), 0)}</span>
        <span class="stat-removed">-{changes.filter(c => c.removed).reduce((s, c) => s + (c.count || 0), 0)}</span>
        <span class="stat-unchanged">±{changes.filter(c => !c.added && !c.removed).reduce((s, c) => s + (c.count || 0), 0)}</span>
      </div>
      <div class="diff-lines">
        {#each changes as change, i}
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
          {:else}
            <div class="diff-line unchanged">
              <span class="line-prefix">&nbsp;</span>
              <span class="line-content">{change.value}</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .diff-viewer {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-raised);
    display: flex;
    flex-direction: column;
    max-height: 400px;
  }

  .diff-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .diff-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .diff-info {
    flex: 1;
    display: flex;
    gap: 8px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .diff-file {
    font-family: monospace;
    color: var(--accent);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 16px;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--bg-hover);
  }

  .diff-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .diff-loading, .diff-error, .diff-empty {
    padding: 16px;
    text-align: center;
    font-size: 12px;
    color: var(--text-dim);
  }

  .diff-stats {
    display: flex;
    gap: 12px;
    padding: 4px 12px 8px;
    font-size: 12px;
    font-family: monospace;
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
  }

  .stat-added {
    color: #22c55e;
  }

  .stat-removed {
    color: #ef4444;
  }

  .stat-unchanged {
    color: var(--text-dim);
  }

  .diff-lines {
    font-family: monospace;
    font-size: 12px;
    line-height: 1.5;
  }

  .diff-line {
    display: flex;
    padding: 0 12px;
    min-height: 20px;
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
</style>
