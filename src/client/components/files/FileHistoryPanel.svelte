<script>
  import { createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { sessionId, sessionToken, csrfToken } from '$stores/session.store.js';
  import { getFileVersions, getVersionContent, rollbackFile } from '$apis/files.api.js';
  import { showToast } from '$stores/ui.store.js';
  import { t } from '$lib/i18n.js';

  const dispatch = createEventDispatcher();

  let { filePath = '' } = $props();
  let versions = $state([]);
  let loading = $state(false);
  let error = $state('');
  let selectedVersionId = $state(null);
  let previewContent = $state('');
  let previewLoading = $state(false);

  // Load versions when filePath changes
  $effect(() => {
    if (filePath) {
      loadVersions();
    } else {
      versions = [];
      selectedVersionId = null;
      previewContent = '';
    }
  });

  async function loadVersions() {
    if (!filePath) return;
    loading = true;
    error = '';
    try {
      const sid = get(sessionId);
      const tok = get(sessionToken);
      if (!sid || !tok) return;
      const result = await getFileVersions(sid, filePath, tok);
      versions = result.versions || [];
    } catch (e) {
      error = e.message || 'Failed to load versions';
      versions = [];
    } finally {
      loading = false;
    }
  }

  async function handleSelectVersion(versionId) {
    if (versionId === selectedVersionId) {
      selectedVersionId = null;
      previewContent = '';
      return;
    }
    selectedVersionId = versionId;
    previewLoading = true;
    try {
      const sid = get(sessionId);
      const tok = get(sessionToken);
      const result = await getVersionContent(sid, versionId, tok);
      previewContent = result.content || '';
    } catch (e) {
      previewContent = '/* ' + (e.message || 'Load failed') + ' */';
    } finally {
      previewLoading = false;
    }
  }

  async function handleRollback(versionId, evt) {
    evt.stopPropagation();
    if (!confirm('确定回滚到该版本？当前内容将被保存为历史版本。')) return;
    try {
      const sid = get(sessionId);
      const tok = get(sessionToken);
      const csrf = get(csrfToken);
      await rollbackFile(sid, versionId, filePath, tok, csrf);
      showToast('已回滚到版本 ' + versionId.substring(0, 8) + '...', 'success');
      dispatch('rollback', { versionId });
      // Reload versions
      await loadVersions();
    } catch (e) {
      showToast('回滚失败: ' + (e.message || 'Unknown error'), 'error');
    }
  }

  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString();
  }

  function actionLabel(action) {
    const map = {
      'save': '保存',
      'delete': '删除前',
      'rollback': '回滚',
      'rollback-save': '回滚前'
    };
    return map[action] || action;
  }

  function truncateHash(hash) {
    if (!hash) return '';
    return hash.substring(0, 8) + '...';
  }
</script>

<div class="history-panel">
  <div class="panel-header">
    <span>{$t('files.versionHistory')}</span>
    {#if filePath}
      <span class="file-label" title={filePath}>{filePath.split('/').pop()}</span>
    {/if}
  </div>

  <div class="panel-body">
    {#if !filePath}
      <div class="empty-state">选择文件以查看版本历史</div>
    {:else if loading}
      <div class="loading-state">{$t('common.loading')}...</div>
    {:else if error}
      <div class="error-state">{error}</div>
    {:else if versions.length === 0}
      <div class="empty-state">尚无历史版本</div>
    {:else}
      <div class="version-list">
        {#each versions as ver}
          <div
            class="version-item"
            class:selected={selectedVersionId === ver.id}
            onclick={() => handleSelectVersion(ver.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => { if (e.key === 'Enter') handleSelectVersion(ver.id); }}
          >
            <div class="version-meta">
              <span class="version-action">{actionLabel(ver.action)}</span>
              <span class="version-time">{formatDate(ver.createdAt)}</span>
            </div>
            <div class="version-info">
              <span class="version-hash" title={ver.hash}>{truncateHash(ver.hash)}</span>
              <span class="version-size">{(ver.size / 1024).toFixed(1)} KB</span>
            </div>
            {#if selectedVersionId === ver.id}
              <div class="version-actions">
                <button
                  class="rollback-btn"
                  onclick={(e) => handleRollback(ver.id, e)}
                  title="回滚到此版本"
                >
                  回滚
                </button>
              </div>
              {#if previewLoading}
                <div class="preview-loading">{$t('common.loading')}...</div>
              {:else if previewContent !== ''}
                <pre class="version-preview">{previewContent.substring(0, 1000)}{previewContent.length > 1000 ? '...' : ''}</pre>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .history-panel {
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    max-height: 300px;
  }

  .panel-header {
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .file-label {
    text-transform: none;
    font-weight: 400;
    color: var(--text);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .empty-state, .loading-state, .error-state {
    padding: 16px;
    text-align: center;
    color: var(--text-dim);
    font-size: 12px;
  }

  .version-list {
    display: flex;
    flex-direction: column;
  }

  .version-item {
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
    transition: background 0.15s;
  }

  .version-item:hover {
    background: var(--bg-hover);
  }

  .version-item.selected {
    background: var(--bg-active);
  }

  .version-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2px;
  }

  .version-action {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .version-time {
    font-size: 11px;
    color: var(--text-dim);
  }

  .version-info {
    display: flex;
    gap: 8px;
    font-size: 11px;
    font-family: monospace;
    color: var(--text-muted);
  }

  .version-hash {
    color: var(--accent);
  }

  .version-actions {
    margin-top: 6px;
    display: flex;
    gap: 6px;
  }

  .rollback-btn {
    padding: 3px 8px;
    font-size: 11px;
    background: var(--danger);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .rollback-btn:hover {
    opacity: 0.9;
  }

  .preview-loading {
    padding: 8px;
    font-size: 11px;
    color: var(--text-dim);
  }

  .version-preview {
    margin-top: 6px;
    padding: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 11px;
    font-family: monospace;
    line-height: 1.4;
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
