<script>
  /**
   * RAG 管理主面板
   *
   * 包含三个 Tab：
   *   - 集合列表（CollectionList）
   *   - 上传文档（UploadForm）
   *   - 搜索测试（SearchTest）
   */
  import RagCollectionList from './RagCollectionList.svelte';
  import RagUploadForm from './RagUploadForm.svelte';
  import RagSearchTest from './RagSearchTest.svelte';
  import { showToast } from '$stores/ui.store.js';
  import { get } from 'svelte/store';
  import { t } from '$lib/i18n.js';

  const TABS = ['collections', 'upload', 'search'];
  let activeTab = $state('collections');

  function handleToast(e) {
    const { text, type } = e.detail;
    showToast(text, type || 'info');
  }

  function handleIngested() {
    // 切换到集合列表
    activeTab = 'collections';
  }
</script>

<div class="rag-panel">
  <div class="panel-tabs">
    {#each TABS as tab}
      <button
        class="panel-tab"
        class:active={activeTab === tab}
        on:click={() => activeTab = tab}
      >
        {tab === 'collections' && t('rag.tab.collections')}
        {tab === 'upload' && t('rag.tab.upload')}
        {tab === 'search' && t('rag.tab.search')}
      </button>
    {/each}
  </div>

  <div class="panel-content">
    {#if activeTab === 'collections'}
      <RagCollectionList on:toast={handleToast} />
    {:else if activeTab === 'upload'}
      <RagUploadForm on:toast={handleToast} on:ingested={handleIngested} />
    {:else if activeTab === 'search'}
      <RagSearchTest on:toast={handleToast} />
    {/if}
  </div>
</div>

<style>
  .rag-panel { min-height: 300px; }
  .panel-tabs {
    display: flex; gap: 4px; margin-bottom: 16px;
    border-bottom: 1px solid var(--border); padding-bottom: 8px;
  }
  .panel-tab {
    flex: 1; padding: 8px 12px; text-align: center; font-size: 13px; font-weight: 500;
    background: none; border: none; border-radius: 6px 6px 0 0;
    color: var(--text-dim); cursor: pointer; transition: all 0.15s;
  }
  .panel-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
  .panel-tab.active {
    color: var(--amber); border-bottom: 2px solid var(--amber);
    background: rgba(245,158,11,0.05);
  }
  .panel-content { }
</style>