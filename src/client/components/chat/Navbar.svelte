<script>
  import { createEventDispatcher } from 'svelte';
  import Icon from '$components/common/Icon.svelte';
  import { currentSession } from '$stores/chatHistory.store.js';
  import { t } from '$lib/i18n.js';

  /** @type {boolean} */
  export let showSidebarToggle = true;
  /** @type {boolean} */
  export let sidebarOpen = false;

  const dispatch = createEventDispatcher();

  function toggleSidebar() {
    dispatch('toggleSidebar');
  }

  function handleNewChat() {
    dispatch('newchat');
  }

  function handleSettings() {
    dispatch('settings');
  }
</script>

<header class="chat-navbar">
  <div class="navbar-left">
    {#if showSidebarToggle}
      <button
        type="button"
        class="icon-btn"
        on:click={toggleSidebar}
        aria-label={sidebarOpen ? $t('command.closeChatSidebar') : $t('command.toggleChatSidebar')}
        title={$t('command.toggleChatSidebar')}
      >
        <Icon name="menu" size="md" />
      </button>
    {/if}

    <div class="navbar-title">
      {#if $currentSession}
        <h1 class="title-text" title={$currentSession.title}>
          {$currentSession.title || $t('chat.new')}
        </h1>
      {:else}
        <h1 class="title-text">{$t('chat.new')}</h1>
      {/if}
    </div>
  </div>

  <div class="navbar-right">
    <button
      type="button"
      class="icon-btn"
      on:click={handleNewChat}
      aria-label={$t('chat.new')}
      title={$t('chat.new')}
    >
      <Icon name="edit" size="md" />
    </button>

    <button
      type="button"
      class="icon-btn"
      on:click={handleSettings}
      aria-label={$t('model.parameters')}
      title={$t('model.parameters')}
    >
      <Icon name="settings" size="md" />
    </button>
  </div>
</header>

<style>
  .chat-navbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 44px;
    padding: 0 12px;
    background: var(--bg-toolbar, var(--bg-base));
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    user-select: none;
  }

  .navbar-left,
  .navbar-right {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .navbar-left {
    flex: 1;
    min-width: 0;
  }

  .navbar-title {
    min-width: 0;
    flex: 1;
    padding: 0 8px;
  }

  .title-text {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn:active {
    background: var(--bg-active, var(--bg-hover));
  }

  .icon-btn:focus-visible {
    outline: 2px solid var(--accent, var(--amber));
    outline-offset: 1px;
  }
</style>
