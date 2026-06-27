<script>
  import { createEventDispatcher } from 'svelte';
  import Icon from '$components/common/Icon.svelte';
  import { openTabs, activeTab } from '$stores/files.store.js';

  const dispatch = createEventDispatcher();

  function selectTab(path) {
    activeTab.set(path);
    dispatch('tabSelect', path);
  }

  function closeTab(e, path) {
    e.stopPropagation();
    dispatch('tabClose', path);
  }

  function handleTabKeydown(e, path) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectTab(path);
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      dispatch('tabClose', path);
    }
  }
</script>

<div class="editor-tabs">
  {#each $openTabs as path}
    <div
      class="editor-tab"
      role="tab"
      tabindex="0"
      class:active={$activeTab === path}
      on:click={() => selectTab(path)}
      on:keydown={(e) => handleTabKeydown(e, path)}
    >
      <span class="tab-name">{path.split('/').pop()}</span>
      <button class="tab-close" on:click={(e) => closeTab(e, path)}>
        <Icon name="close" size="sm" />
      </button>
    </div>
  {/each}
</div>

<style>
  .editor-tabs {
    display: flex;
    align-items: center;
    background: var(--bg-toolbar);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    overflow-y: hidden;
    flex-shrink: 0;
    min-height: 32px;
  }

  .editor-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-muted);
    cursor: pointer;
    border-right: 1px solid var(--border);
    white-space: nowrap;
    transition: background 0.15s ease, color 0.15s ease;
    flex-shrink: 0;
  }

  .editor-tab:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .editor-tab.active {
    background: var(--bg-base);
    color: var(--amber-bright);
    border-bottom: 2px solid var(--amber);
  }

  .tab-close {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    background: none;
    border: none;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    transition: opacity 0.15s, background 0.15s;
  }

  .tab-close:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
  }
</style>
