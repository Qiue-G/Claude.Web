<script>
  /**
   * RAG 集合列表
   * 展示所有集合，支持删除
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import { listCollections, deleteCollection, getRagStatus } from '$apis/rag.api.js';
  import { sessionId, sessionToken, csrfToken } from '$stores/session.store.js';
  import { get } from 'svelte/store';
  import { t } from '$lib/i18n.js';
  import Icon from '$components/common/Icon.svelte';

  const dispatch = createEventDispatcher();

  let collections = $state([]);
  let totalDocs = $state(0);
  let loading = $state(true);
  let deleting = $state(null);
  let error = $state('');
  let ragEnabled = $state(false);
  let embedderModel = $state('');

  onMount(() => { loadCollections(); });

  async function loadCollections() {
    loading = true;
    error = '';
    try {
      const sid = get(sessionId);
      const tok = get(sessionToken);
      if (!sid || !tok) {
        error = '请先连接模型';
        loading = false;
        return;
      }

      const [colRes, statusRes] = await Promise.all([
        listCollections(tok).catch(() => ({ collections: [], totalDocs: 0 })),
        getRagStatus(tok).catch(() => ({ enabled: false, totalDocs: 0 })),
      ]);

      collections = colRes.collections || [];
      totalDocs = colRes.totalDocs || 0;
      ragEnabled = statusRes.enabled || false;
      embedderModel = statusRes.embedderModel || '';
    } catch (e) {
      error = e.message || '加载失败';
    } finally {
      loading = false;
    }
  }

  async function handleDelete(name) {
    if (!confirm(`确定删除集合 "${name}"？`)) return;
    deleting = name;
    try {
      const sid = get(sessionId);
      const tok = get(sessionToken);
      const csrf = get(csrfToken);
      await deleteCollection(name, sid, tok, csrf);
      collections = collections.filter(c => c !== name);
      dispatch('toast', { text: `集合 "${name}" 已删除`, type: 'success' });
    } catch (e) {
      dispatch('toast', { text: `删除失败: ${e.message}`, type: 'error' });
    } finally {
      deleting = null;
    }
  }
</script>

<div class="collection-list">
  <div class="header">
    <h4>RAG 知识库</h4>
    <div class="header-actions">
      <span class="status-badge" class:enabled={ragEnabled}>
        {ragEnabled ? '已启用' : '未启用'}
      </span>
      {#if embedderModel}
        <span class="model-badge">{embedderModel}</span>
      {/if}
      <button class="refresh-btn" on:click={loadCollections} disabled={loading}>
        <Icon name="refresh" size="sm" />
      </button>
    </div>
  </div>

  {#if error}
    <div class="error-msg">{error}</div>
  {/if}

  {#if loading}
    <div class="loading">加载中...</div>
  {:else if collections.length === 0}
    <div class="empty">
      <p>暂无集合</p>
      <p class="hint">切换到「上传」标签添加文档</p>
    </div>
  {:else}
    <div class="stats">
      共 {collections.length} 个集合，{totalDocs} 个文档
    </div>
    <div class="list">
      {#each collections as name}
        <div class="collection-item">
          <div class="collection-info">
            <Icon name="folder" size="sm" />
            <span class="name">{name}</span>
          </div>
          <button
            class="delete-btn"
            on:click={() => handleDelete(name)}
            disabled={deleting === name}
            title="删除集合"
          >
            {deleting === name ? '删除中...' : '删除'}
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .collection-list { padding: 0; }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px; gap: 8px; flex-wrap: wrap;
  }
  .header h4 { margin: 0; font-size: 14px; color: var(--text-primary); }
  .header-actions { display: flex; align-items: center; gap: 8px; }
  .status-badge {
    font-size: 11px; padding: 2px 8px; border-radius: 10px;
    background: var(--bg-input); color: var(--text-dim);
  }
  .status-badge.enabled { background: rgba(34,197,94,0.15); color: var(--green); }
  .model-badge {
    font-size: 11px; padding: 2px 8px; border-radius: 10px;
    background: var(--bg-accent-dim); color: var(--accent);
    max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .refresh-btn {
    width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
    background: none; border: none; color: var(--text-muted); cursor: pointer; border-radius: 4px;
  }
  .refresh-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .refresh-btn:disabled { opacity: 0.5; cursor: default; }
  .error-msg { color: var(--red); font-size: 13px; padding: 8px 0; }
  .loading { color: var(--text-dim); font-size: 13px; padding: 24px 0; text-align: center; }
  .empty { color: var(--text-dim); font-size: 13px; padding: 24px 0; text-align: center; }
  .empty .hint { font-size: 12px; margin-top: 4px; color: var(--text-muted); }
  .stats { font-size: 12px; color: var(--text-dim); margin-bottom: 8px; }
  .list { display: flex; flex-direction: column; gap: 4px; }
  .collection-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px; border-radius: 6px; transition: background 0.15s;
  }
  .collection-item:hover { background: var(--bg-hover); }
  .collection-info { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .collection-info :global(.icon) { flex-shrink: 0; }
  .name { font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .delete-btn {
    font-size: 12px; padding: 2px 8px; border-radius: 4px;
    background: none; border: 1px solid var(--border); color: var(--text-dim);
    cursor: pointer; flex-shrink: 0; transition: all 0.15s;
  }
  .delete-btn:hover { background: rgba(239,68,68,0.1); color: var(--red); border-color: var(--red); }
  .delete-btn:disabled { opacity: 0.5; cursor: default; }
</style>