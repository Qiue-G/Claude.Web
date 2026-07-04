<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { authToken, authUser } from '$stores/auth.store.js';
  import { showToast } from '$stores/ui.store.js';
  import {
    getMessageVersions,
    restoreVersion,
    getVersionDiff
  } from '$apis/session.api.js';
  import Icon from '$components/common/Icon.svelte';

  export let sessionId = '';
  export let messageId = '';
  export let open = false;

  const dispatch = createEventDispatcher();

  /** @type {Array<{id: string, version: number, content: string, createdBy: string|null, createdAt: string}>} */
  let versions = [];
  let loading = false;
  let restoring = false;
  let error = '';

  // 差异视图状态
  let showDiff = false;
  let diffData = null;
  let diffV1 = null;
  let diffV2 = null;
  let diffLoading = false;

  // Refs
  let modalEl;

  $: if (open && messageId) {
    loadVersions();
  }

  async function loadVersions() {
    if (!$authToken) return;
    loading = true;
    error = '';
    try {
      const data = await getMessageVersions(sessionId, messageId, $authToken);
      versions = data.versions || [];
      if (versions.length === 0) {
        error = '暂无版本历史记录';
      }
    } catch (e) {
      error = e.message || '加载版本历史失败';
      console.error('[VersionHistory] load error:', e);
    } finally {
      loading = false;
    }
  }

  async function handleRestore(version) {
    if (!$authToken) {
      showToast('请先登录', 'error');
      return;
    }
    restoring = true;
    try {
      await restoreVersion(sessionId, messageId, version, $authToken);
      showToast(`已回滚到版本 ${version}`, 'success');
      handleClose();
      dispatch('restored', { messageId, version });
    } catch (e) {
      showToast(e.message || '回滚失败', 'error');
    } finally {
      restoring = false;
    }
  }

  async function handleShowDiff(v1, v2) {
    if (!$authToken) return;
    diffV1 = v1;
    diffV2 = v2;
    diffLoading = true;
    diffData = null;
    try {
      const data = await getVersionDiff(sessionId, messageId, v1, v2, $authToken);
      diffData = data.diff || [];
      showDiff = true;
    } catch (e) {
      showToast(e.message || '加载差异失败', 'error');
    } finally {
      diffLoading = false;
    }
  }

  function handleCloseDiff() {
    showDiff = false;
    diffData = null;
    diffV1 = null;
    diffV2 = null;
  }

  function handleClose() {
    open = false;
    handleCloseDiff();
    dispatch('close');
  }

  function handleBackdropClick(e) {
    if (e.target === modalEl) {
      handleClose();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }

  function formatTime(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr + 'Z');
      return d.toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_) {
      return dateStr;
    }
  }

  function previewContent(content, maxLen = 60) {
    if (!content) return '(空)';
    const clean = content.replace(/\n/g, ' ').trim();
    return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div
    bind:this={modalEl}
    class="version-modal-overlay"
    role="presentation"
    on:click={handleBackdropClick}
    transition:fade={{ duration: 150 }}
  >
    <div
      class="version-modal-content"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      transition:fly={{ y: 20, duration: 200 }}
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <div class="version-modal-header">
        <h3 class="version-modal-title">
          {showDiff ? '版本差异比较' : '版本历史'}
        </h3>
        <button class="version-modal-close" on:click={showDiff ? handleCloseDiff : handleClose} aria-label="关闭">
          &times;
        </button>
      </div>

      <div class="version-modal-body">
        {#if showDiff}
          <!-- 差异视图 -->
          <div class="diff-header">
            <button class="diff-back-btn" on:click={handleCloseDiff}>
              <Icon name="arrowLeft" size="sm" />
              返回列表
            </button>
            <span class="diff-label">V{diffV1} → V{diffV2}</span>
          </div>
          <div class="diff-content">
            {#if diffData && diffData.length > 0}
              {#each diffData as item, i}
                <div class="diff-line diff-{item.type}" class:diff-first={i === 0}>
                  <span class="diff-line-num">{item.lineNumber}</span>
                  <span class="diff-line-prefix">{item.type === 'added' ? '+' : item.type === 'removed' ? '-' : ' '}</span>
                  <span class="diff-line-text">{item.line || ' '}</span>
                </div>
              {/each}
            {:else}
              <div class="diff-empty">两个版本内容相同</div>
            {/if}
          </div>
        {:else if loading}
          <div class="version-loading">加载中...</div>
        {:else if error && versions.length === 0}
          <div class="version-error">{error}</div>
        {:else}
          <div class="version-list">
            {#each versions as ver, i}
              <div class="version-item">
                <div class="version-item-header">
                  <span class="version-badge">V{ver.version}</span>
                  <span class="version-time">{formatTime(ver.createdAt)}</span>
                  {#if ver.createdBy}
                    <span class="version-author">{ver.createdBy}</span>
                  {/if}
                </div>
                <div class="version-preview">{previewContent(ver.content)}</div>
                <div class="version-actions">
                  <button
                    class="version-action-btn"
                    on:click={() => handleRestore(ver.version)}
                    disabled={restoring}
                    title="回滚到此版本"
                  >
                    <Icon name="refresh" size="sm" />
                    回滚
                  </button>
                  {#if i < versions.length - 1}
                    <button
                      class="version-action-btn"
                      on:click={() => handleShowDiff(ver.version, versions[i + 1].version)}
                      title="与上一版本比较差异"
                    >
                      <Icon name="fileText" size="sm" />
                      比较
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .version-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .version-modal-content {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 90%;
    max-width: 560px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }

  .version-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .version-modal-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .version-modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 20px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    line-height: 1;
  }

  .version-modal-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .version-modal-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
  }

  .version-loading,
  .version-error {
    text-align: center;
    color: var(--text-muted);
    padding: 32px 16px;
  }

  .version-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .version-item {
    padding: 12px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    transition: background 0.15s ease;
  }

  .version-item:hover {
    background: var(--bg-hover);
  }

  .version-item-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .version-badge {
    display: inline-block;
    padding: 2px 8px;
    background: var(--accent);
    color: white;
    font-size: 11px;
    font-weight: 700;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .version-time {
    font-size: 11px;
    color: var(--text-muted);
  }

  .version-author {
    font-size: 11px;
    color: var(--text-muted);
    margin-left: auto;
  }

  .version-preview {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin-bottom: 8px;
    word-break: break-all;
  }

  .version-actions {
    display: flex;
    gap: 6px;
  }

  .version-action-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .version-action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }

  .version-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* 差异视图 */
  .diff-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .diff-back-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .diff-back-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .diff-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .diff-content {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    line-height: 1.6;
  }

  .diff-line {
    display: flex;
    padding: 1px 8px;
  }

  .diff-line.diff-first {
    padding-top: 4px;
  }

  .diff-added {
    background: rgba(34, 197, 94, 0.12);
  }

  .diff-removed {
    background: rgba(239, 68, 68, 0.12);
  }

  .diff-unchanged {
    color: var(--text-muted);
  }

  .diff-line-num {
    width: 32px;
    text-align: right;
    padding-right: 8px;
    color: var(--text-muted);
    flex-shrink: 0;
    user-select: none;
  }

  .diff-line-prefix {
    width: 16px;
    flex-shrink: 0;
    font-weight: 700;
  }

  .diff-added .diff-line-prefix {
    color: var(--green, #22c55e);
  }

  .diff-removed .diff-line-prefix {
    color: var(--red, #ef4444);
  }

  .diff-line-text {
    flex: 1;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .diff-empty {
    text-align: center;
    padding: 24px;
    color: var(--text-muted);
    font-size: 13px;
  }
</style>
