<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '$components/common/Icon.svelte';
  import { listDirectory } from '$apis/files.api.js';

  export let item;
  export let depth = 0;
  export let isActive = false;
  export let sessionId = '';
  export let token = '';

  const dispatch = createEventDispatcher();

  let isOpen = false;
  let contextMenuVisible = false;
  let contextMenuX = 0;
  let contextMenuY = 0;
  let renaming = false;
  let newName = '';
  let renameInput;

  // 懒加载状态
  let loaded = false;
  let loading = false;
  let localChildren = [];

  async function toggle() {
    if (item.type === 'directory') {
      isOpen = !isOpen;
      if (isOpen && !loaded && sessionId && token) {
        await lazyLoadChildren();
      }
      dispatch('toggle', item);
    } else {
      dispatch('select', item);
    }
  }

  async function lazyLoadChildren() {
    loading = true;
    try {
      const result = await listDirectory(sessionId, item.path, token);
      if (result && result.items) {
        localChildren = result.items;
        loaded = true;
      }
    } catch (err) {
      console.error('Failed to load directory:', err.message);
    } finally {
      loading = false;
    }
  }

  // 兼容旧数据：如果有预加载的 children，直接使用
  $: if (item.children && item.children.length > 0 && !loaded) {
    localChildren = item.children;
    loaded = true;
  }

  function handleContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    contextMenuX = e.clientX;
    contextMenuY = e.clientY;
    contextMenuVisible = true;
  }

  function closeContextMenu() {
    contextMenuVisible = false;
  }

  function handleDelete() {
    closeContextMenu();
    if (!confirm(`确定删除 "${item.name}"？`)) return;
    dispatch('delete', item);
  }

  function startRename() {
    newName = item.name;
    renaming = true;
    contextMenuVisible = false;
    requestAnimationFrame(() => {
      if (renameInput) {
        renameInput.focus();
        const dotIdx = newName.lastIndexOf('.');
        if (dotIdx > 0) {
          renameInput.setSelectionRange(0, dotIdx);
        } else {
          renameInput.select();
        }
      }
    });
  }

  function submitRename() {
    if (!renaming) return;
    renaming = false;
    if (!newName || newName.trim() === '' || newName === item.name) return;
    const parts = item.path.split('/');
    parts[parts.length - 1] = newName.trim();
    const newPath = parts.join('/');
    dispatch('rename', { oldItem: item, newPath });
  }

  function handleRenameKeydown(e) {
    if (e.key === 'Enter') submitRename();
    if (e.key === 'Escape') renaming = false;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tree-item {item.type}" class:active={isActive}
  style="padding-left: {depth * 16 + 12}px"
  on:contextmenu={handleContextMenu}>

  {#if item.type === 'directory'}
    <span class="arrow">
      <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size="sm" />
    </span>
  {:else}
    <span class="arrow"></span>
  {/if}

  <Icon name={item.type === 'directory' ? 'folder' : 'file'} size="md" />

  {#if renaming}
    <input
      class="rename-input"
      type="text"
      bind:value={newName}
      bind:this={renameInput}
      on:keydown={handleRenameKeydown}
      on:blur={submitRename}
    />
  {:else}
    <span class="tree-label" role="treeitem" tabindex="0" aria-selected="false" on:click={toggle} on:keydown>
      {item.name}
    </span>
  {/if}

  {#if loading}
    <span class="loading-spinner"></span>
  {/if}
</div>

{#if contextMenuVisible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="menu-backdrop" on:click={closeContextMenu} on:contextmenu|preventDefault={closeContextMenu}></div>
  <div class="context-menu" style="left: {contextMenuX}px; top: {contextMenuY}px;">
    <button class="menu-item" on:click={startRename} on:focus>
      <Icon name="edit" size="sm" /> 重命名
    </button>
    <button class="menu-item menu-item-danger" on:click={handleDelete} on:focus>
      <Icon name="trash" size="sm" /> 删除
    </button>
  </div>
{/if}

{#if item.type === 'directory' && isOpen}
  {#if loading}
    <div class="empty-dir" style="padding-left: {depth * 16 + 36}px">加载中...</div>
  {:else if localChildren.length === 0}
    <div class="empty-dir" style="padding-left: {depth * 16 + 36}px">空目录</div>
  {:else}
    {#each localChildren as child}
      <svelte:self item={child} depth={depth + 1} {isActive} {sessionId} {token}
        on:select on:delete on:rename />
    {/each}
  {/if}
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
    user-select: none;
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
    flex: 1;
    min-width: 0;
  }

  .rename-input {
    flex: 1;
    min-width: 0;
    padding: 1px 4px;
    font-size: 13px;
    font-family: inherit;
    background: var(--bg-input);
    border: 1px solid var(--accent);
    border-radius: 3px;
    color: var(--text-primary);
    outline: none;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }

  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px;
    min-width: 140px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    border-radius: 4px;
    text-align: left;
  }

  .menu-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .menu-item-danger:hover {
    background: rgba(239,68,68,0.15);
    color: #ef4444;
  }

  .empty-dir {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
    padding: 2px 0;
  }

  .loading-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    margin-left: auto;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
