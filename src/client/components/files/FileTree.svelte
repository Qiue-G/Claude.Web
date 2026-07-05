<script>
  import FileItem from './FileItem.svelte';
  import { fileTree, currentFile } from '$stores/files.store.js';
  import { createEventDispatcher } from 'svelte';
  import { t } from '$lib/i18n.js';

  const dispatch = createEventDispatcher();

  let dragOver = false;
  let dragEnterCount = 0;

  function handleSelect(e) {
    const item = e.detail;
    if (item.type === 'file') {
      dispatch('fileSelect', item);
    }
  }

  function handleDelete(e) {
    dispatch('fileDelete', e.detail);
  }

  function handleRename(e) {
    dispatch('fileRename', e.detail);
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
    dispatch('fileUpload', fileList);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="file-tree-panel"
  on:dragenter={handleDragEnter}
  on:dragleave={handleDragLeave}
  on:dragover={handleDragOver}
  on:drop={handleDrop}
>
  <div class="panel-header">
    {$t('files.title')}
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
          isActive={$currentFile === item.path}
          on:select={handleSelect}
          on:delete={handleDelete}
          on:rename={handleRename}
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
