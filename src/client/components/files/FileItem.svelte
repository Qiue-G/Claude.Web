<script>
  import { createEventDispatcher } from 'svelte';
  import Icon from '$components/common/Icon.svelte';

  export let item;
  export let depth = 0;
  export let isActive = false;

  const dispatch = createEventDispatcher();

  let isOpen = false;

  function toggle() {
    if (item.type === 'directory') {
      isOpen = !isOpen;
      dispatch('toggle', item);
    } else {
      dispatch('select', item);
    }
  }
</script>

<div class="tree-item {item.type}" class:active={isActive} style="padding-left: {depth * 16 + 12}px">
  {#if item.type === 'directory'}
    <span class="arrow">
      <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size="sm" />
    </span>
  {:else}
    <span class="arrow"></span>
  {/if}

  <Icon name={item.type === 'directory' ? 'folder' : 'file'} size="md" />

  <span class="tree-label" role="treeitem" tabindex="0" aria-selected="false" on:click={toggle} on:keydown>
    {item.name}
  </span>
</div>

{#if item.type === 'directory' && isOpen && item.children}
  {#each item.children as child}
    <svelte:self item={child} depth={depth + 1} {isActive} on:select />
  {/each}
{/if}

<style>
  .tree-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
    transition: background 0.15s ease, color 0.15s ease;
    white-space: nowrap;
    border-radius: 4px;
    margin: 0 4px;
  }

  .tree-item:hover {
    background: var(--bg-hover);
  }

  .tree-item.active {
    background: var(--bg-accent-dim2);
    color: var(--amber-bright);
  }

  .tree-item.folder {
    font-weight: 500;
  }

  .arrow {
    width: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .tree-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
