<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { authToken, authUser } from '$stores/auth.store.js';
  import { showToast } from '$stores/ui.store.js';
  import {
    shareSession,
    unshareSession,
    addCollaborator,
    removeCollaborator,
    getCollaborators,
    getSession
  } from '$apis/session.api.js';
  import Icon from '$components/common/Icon.svelte';

  export let sessionId = '';
  export let open = false;

  const dispatch = createEventDispatcher();

  /** @type {{ id: string, username: string }[]} */
  let collaborators = [];
  let isShared = false;
  let shareUrl = '';
  let loading = false;
  let collaboratorInput = '';
  let addingCollaborator = false;

  // Refs
  let modalEl;
  let modalContent;

  $: if (open && sessionId) {
    loadShareState();
  }

  async function loadShareState() {
    if (!$authToken) return;
    loading = true;
    try {
      const data = await getCollaborators(sessionId, $authToken);
      collaborators = data.collaborators || [];

      // 检查是否已共享
      try {
        const resp = await fetch(`/api/session/${sessionId}`);
        if (resp.ok) {
          const info = await resp.json();
          isShared = info.status === 'shared';
        }
      } catch (_) {}
    } catch (e) {
      console.error('Failed to load share state:', e);
    } finally {
      loading = false;
    }
  }

  async function handleToggleShare() {
    if (!$authToken) {
      showToast('请先登录', 'error');
      return;
    }
    loading = true;
    try {
      if (isShared) {
        await unshareSession(sessionId, $authToken);
        isShared = false;
        shareUrl = '';
        showToast('已取消分享', 'success');
      } else {
        const result = await shareSession(sessionId, $authToken);
        isShared = true;
        shareUrl = `${window.location.origin}/join/${result.shareToken}`;
        showToast('分享链接已生成', 'success');
      }
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    } finally {
      loading = false;
    }
  }

  async function handleAddCollaborator() {
    const username = collaboratorInput.trim();
    if (!username) return;
    if (!$authToken) {
      showToast('请先登录', 'error');
      return;
    }
    addingCollaborator = true;
    try {
      const result = await addCollaborator(sessionId, username, $authToken);
      collaborators = result.collaborators || [];
      collaboratorInput = '';
      showToast('已添加协作者', 'success');
    } catch (e) {
      showToast(e.message || '添加失败', 'error');
    } finally {
      addingCollaborator = false;
    }
  }

  async function handleRemoveCollaborator(username) {
    if (!$authToken) return;
    try {
      const result = await removeCollaborator(sessionId, username, $authToken);
      collaborators = result.collaborators || [];
      showToast('已移除协作者', 'success');
    } catch (e) {
      showToast(e.message || '移除失败', 'error');
    }
  }

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('链接已复制', 'success');
    } catch (_) {
      // Fallback
      const el = document.createElement('textarea');
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      showToast('链接已复制', 'success');
    }
  }

  function handleClose() {
    open = false;
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
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div
    bind:this={modalEl}
    class="share-modal-overlay"
    role="presentation"
    on:click={handleBackdropClick}
    on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleBackdropClick(e); }}
    transition:fade={{ duration: 150 }}
  >
    <div
      bind:this={modalContent}
      class="share-modal-content"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      transition:fly={{ y: 20, duration: 200 }}
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <div class="share-modal-header">
        <h3 class="share-modal-title">分享会话</h3>
        <button class="share-modal-close" on:click={handleClose} aria-label="关闭">
          &times;
        </button>
      </div>

      <div class="share-modal-body">
        {#if !$authToken}
          <div class="share-notice">请先登录后才能使用分享功能</div>
        {:else if loading && collaborators.length === 0}
          <div class="share-loading">加载中...</div>
        {:else}
          <!-- 分享开关 -->
          <div class="share-section">
            <div class="share-section-header">
              <span>分享链接</span>
              <button
                class="share-toggle"
                class:active={isShared}
                on:click={handleToggleShare}
                disabled={loading}
              >
                {isShared ? '关闭分享' : '开启分享'}
              </button>
            </div>
            {#if isShared && shareUrl}
              <div class="share-url-box">
                <input
                  type="text"
                  class="share-url-input"
                  value={shareUrl}
                  readonly
                />
                <button class="share-copy-btn" on:click={copyShareUrl} title="复制链接">
                  <Icon name="copy" size="sm" />
                </button>
              </div>
            {/if}
          </div>

          <!-- 协作者列表 -->
          <div class="share-section">
            <div class="share-section-header">
              <span>协作者</span>
            </div>
            <div class="collaborator-list">
              {#if collaborators.length === 0}
                <div class="collaborator-empty">暂无协作者</div>
              {:else}
                {#each collaborators as collab}
                  <div class="collaborator-item">
                    <div class="collaborator-avatar">
                      {collab.username.charAt(0).toUpperCase()}
                    </div>
                    <span class="collaborator-name">{collab.username}</span>
                    <button
                      class="collaborator-remove"
                      on:click={() => handleRemoveCollaborator(collab.username)}
                      title="移除协作者"
                    >
                      <Icon name="x" size="sm" />
                    </button>
                  </div>
                {/each}
              {/if}
            </div>
          </div>

          <!-- 添加协作者 -->
          <div class="share-section">
            <div class="share-section-header">
              <span>添加协作者</span>
            </div>
            <div class="add-collaborator">
              <input
                type="text"
                class="add-collaborator-input"
                placeholder="输入用户名..."
                bind:value={collaboratorInput}
                on:keydown={(e) => { if (e.key === 'Enter') handleAddCollaborator(); }}
              />
              <button
                class="add-collaborator-btn"
                on:click={handleAddCollaborator}
                disabled={addingCollaborator || !collaboratorInput.trim()}
              >
                {addingCollaborator ? '添加中...' : '添加'}
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .share-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .share-modal-content {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 90%;
    max-width: 460px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }

  .share-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .share-modal-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .share-modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 20px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    line-height: 1;
  }

  .share-modal-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .share-modal-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .share-notice {
    text-align: center;
    color: var(--text-muted);
    padding: 20px;
  }

  .share-loading {
    text-align: center;
    color: var(--text-muted);
    padding: 20px;
  }

  .share-section {
    margin-bottom: 20px;
  }

  .share-section:last-child {
    margin-bottom: 0;
  }

  .share-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .share-toggle {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .share-toggle:hover {
    background: var(--bg-hover);
  }

  .share-toggle.active {
    background: var(--red);
    color: white;
    border-color: var(--red);
  }

  .share-toggle:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .share-url-box {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px;
  }

  .share-url-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 13px;
    padding: 6px 8px;
    font-family: inherit;
  }

  .share-copy-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .share-copy-btn:hover {
    opacity: 0.85;
  }

  .collaborator-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .collaborator-empty {
    text-align: center;
    color: var(--text-muted);
    padding: 12px;
    font-size: 13px;
  }

  .collaborator-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--bg-input);
    transition: background 0.15s ease;
  }

  .collaborator-item:hover {
    background: var(--bg-hover);
  }

  .collaborator-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .collaborator-name {
    flex: 1;
    font-size: 13px;
    color: var(--text-primary);
  }

  .collaborator-remove {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .collaborator-remove:hover {
    background: rgba(239, 68, 68, 0.1);
    color: var(--red);
  }

  .add-collaborator {
    display: flex;
    gap: 6px;
  }

  .add-collaborator-input {
    flex: 1;
    padding: 8px 10px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }

  .add-collaborator-input:focus {
    border-color: var(--accent);
  }

  .add-collaborator-input::placeholder {
    color: var(--text-muted);
  }

  .add-collaborator-btn {
    padding: 8px 14px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease;
  }

  .add-collaborator-btn:hover {
    opacity: 0.85;
  }

  .add-collaborator-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
