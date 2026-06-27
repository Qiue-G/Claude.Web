<script>
  import FileItem from './FileItem.svelte';
  import { fileTree, currentFile } from '$stores/files.store.js';
  import { createEventDispatcher } from 'svelte';
  import { t } from '$lib/i18n.js';

  const dispatch = createEventDispatcher();

  function handleSelect(e) {
    const item = e.detail;
    if (item.type === 'file') {
      dispatch('fileSelect', item);
    }
  }
</script>

<div class="file-tree-panel">
  <div class="panel-header">
    {$t('files.title')}
  </div>
  <div class="file-tree">
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
        />
      {/each}
    {/if}
  </div>
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
  }

  .empty-state {
    padding: 20px;
    text-align: center;
    color: var(--text-dim);
    font-size: 13px;
  }
</style>
