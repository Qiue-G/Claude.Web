<script>
  import FileItem from './FileItem.svelte';
  import { fileTree, currentFile } from '$stores/files.store.js';
  import { t } from '$lib/i18n.js';
  import { get } from 'svelte/store';

  export let sessionId = '';
  export let token = '';

  export let onfileSelect = null;
  export let onfileDelete = null;
  export let onfileRename = null;
  export let onfileUpload = null;

  let dragOver = false;
  let dragEnterCount = 0;
  let searchQuery = '';

  function handleSelect(item) {
    if (item.type === 'file') {
      onfileSelect?.(item);
    }
  }

  function handleDelete(item) {
    onfileDelete?.(item);
  }

  function handleRename(detail) {
    onfileRename?.(detail);
  }

  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    dragEnterCount++;
    dragOver = true;
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragEnterCount--;
    if (dragEnterCount <= 0) {
      dragEnterCount = 0;
      dragOver = false;
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dragEnterCount = 0;
    dragOver = false;

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const fileList = [];
    for (let i = 0; i < files.length; i++) {
      fileList.push(files[i]);
    }
    onfileUpload?.(fileList);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="file-tree-panel"
  ondragenter={handleDragEnter}
  ondragleave={handleDragLeave}
  ondragover={handleDragOver}
  ondrop={handleDrop}
>
  <div class="panel-header">
    {$t('files.title')}
  </div>
  <div class="search-box">
    <input
      type="text"
      class="search-input"
      placeholder={$t('files.search')}
      bind:value={searchQuery}
    />
    {#if searchQuery}
      <button class="search-clear" onclick={() => searchQuery = ''}>×</button>
    {/if}
  </div>
  <div class="file-tree" class:drag-over={dragOver}>
    {#if $fileTree.length === 0}
      <div class="empty-state">
        {$t('files.noFiles')}
      </div>
    {:else}
      {#each $fileTree as item}
        <FileItem
          {item}
          depth={0}
          {sessionId}
          {token}
          isActive={$currentFile === item.path}
          searchQuery={searchQuery.toLowerCase().trim()}
          onselect={handleSelect}
          ondelete={handleDelete}
          onrename={handleRename}
        />
      {/each}
    {/if}
  </div>
  {#if dragOver}
    <div class="drop-indicator">
      释放以上传文件
    </div>
  {/if}
</div>

<style>
  .file-tree-panel {
    width: 240px;
    background: var(--bg-raised);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    overflow: hidden;
    position: relative;
  }

  .panel-header {
    padding: 10px 14px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search-box {
    position: relative;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search-input {
    width: 100%;
    padding: 5px 24px 5px 8px;
    font-size: 13px;
    font-family: inherit;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s ease;
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .search-clear {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .search-clear:hover {
    color: var(--text-primary);
  }

  .file-tree {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
    transition: background 0.15s ease;
  }

  .file-tree.drag-over {
    background: var(--bg-accent-dim);
  }

  .empty-state {
    padding: 20px;
    text-align: center;
    color: var(--text-dim);
    font-size: 13px;
  }

  .drop-indicator {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.4);
    color: white;
    font-size: 14px;
    font-weight: 600;
    pointer-events: none;
    z-index: 10;
  }
</style>
