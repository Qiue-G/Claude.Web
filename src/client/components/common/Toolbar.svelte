<script>
  import Icon from '$components/common/Icon.svelte';
  import ModelSelector from '$components/models/ModelSelector.svelte';
  import ThemeToggle from '$components/common/ThemeToggle.svelte';
  import LanguageSelector from '$components/common/LanguageSelector.svelte';
  import { connectionStatus } from '$stores/session.store.js';
  import { onlineUsers } from '$stores/collab.store.js';
  import { authUser } from '$stores/auth.store.js';
  import { tokenStats } from '$stores/chat.store.js';
  import { t } from '$lib/i18n.js';
  import { registeredToolbarItems, executeCommand } from '$stores/plugins.store.js';

  export let ontoggleSidebar = null;
  export let onopenConfig = null;
  export let onopenRag = null;
  export let onopenAdmin = null;
  export let onselectModel = null;

  function handleToggleSidebar() {
    ontoggleSidebar?.();
  }

  function handleOpenConfig() {
    onopenConfig?.();
  }

  function handleOpenRag() {
    onopenRag?.();
  }

  function handleOpenAdmin() {
    onopenAdmin?.();
  }

  function handleModelSelect(model) {
    onselectModel?.(model);
  }

  function formatTokens(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  $: tokenPct = $tokenStats.inputMax > 0
    ? Math.round(($tokenStats.input / $tokenStats.inputMax) * 100)
    : 0;
</script>

<div class="toolbar">
  <div class="toolbar-left">
    <button class="toolbar-btn" onclick={handleToggleSidebar} title={$t('command.toggleSidebar')}>
      <Icon name="panelLeft" size="md" />
    </button>

    <div class="toolbar-divider"></div>

    <div class="project-info">
      <span class="project-name">Free Code</span>
      <div class="connection-status" class:connected={$connectionStatus === 'connected'}>
        <span class="status-dot"></span>
        <span class="status-text">
          {#if $connectionStatus === 'connected'}
            {$t('status.connected')}
          {:else if $connectionStatus === 'reconnecting'}
            {$t('status.reconnecting')}
          {:else if $connectionStatus === 'connecting'}
            {$t('status.connecting')}
          {:else}
            {$t('status.disconnected')}
          {/if}
        </span>
      </div>
    </div>

      {#if $connectionStatus === 'connected' || $onlineUsers.length > 0}
        <div class="online-users" title={$onlineUsers.map(u => u.username).join(', ') || '协作已就绪'}>
          {#if $connectionStatus === 'connected'}
            <span class="online-user-avatar online-self" style="background:var(--accent)" title="自己 — {$authUser?.username || 'anonymous'}">
              {($authUser?.username || '?')[0].toUpperCase()}
            </span>
          {/if}
          {#each ($connectionStatus === 'connected'
            ? $onlineUsers.filter(u => u.username && u.username !== ($authUser?.username || ''))
            : $onlineUsers) as user}
            <span class="online-user-avatar" style="background:{user.color || '#888'}" title={user.username}>
              {(user.username || '?')[0].toUpperCase()}
            </span>
          {/each}
        </div>
      {/if}

      {#if $tokenStats.input > 0}
      <div class="token-stats" title={$t('toolbar.tokenUsage')}>
        <span class="token-label">{$t('toolbar.tokens')}</span>
        <div class="token-bar">
          <div class="token-fill" style="width: {Math.min(tokenPct, 100)}%"></div>
        </div>
        <span class="token-value">{formatTokens($tokenStats.input)} / {formatTokens($tokenStats.inputMax)}</span>
      </div>
    {/if}
  </div>

  <div class="toolbar-right">
    <a
      class="toolbar-btn api-docs-btn"
      href="/api/docs/"
      target="_blank"
      rel="noopener noreferrer"
      title="API 文档 (Swagger)"
    >
      <span class="api-label">API</span>
    </a>
    {#if $registeredToolbarItems.length > 0}
      <div class="toolbar-divider"></div>
      {#each $registeredToolbarItems as item}
        <button class="toolbar-btn" onclick={() => executeCommand(item.command)}
          title={item.label}>
          <Icon name={item.icon || 'puzzle'} />
        </button>
      {/each}
    {/if}
    <ThemeToggle />
    <LanguageSelector />
    <button class="toolbar-btn rag-btn" onclick={handleOpenRag} title={$t('rag.button')}>
      <span class="rag-label">RAG</span>
    </button>
    <button class="toolbar-btn admin-btn" onclick={handleOpenAdmin} title={$t('admin.button')}>
      <Icon name="shield" size="md" />
    </button>
    <ModelSelector
      onselect={handleModelSelect}
      onopenConfig={handleOpenConfig}
    />
  </div>
</div>

<style>
  .toolbar {
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    background: var(--bg-toolbar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .toolbar-left,
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .toolbar-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .toolbar-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .toolbar-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .api-docs-btn {
    text-decoration: none;
  }

  .api-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--accent);
  }

  .rag-btn:hover .rag-label {
    color: var(--amber);
  }

  .rag-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }

  .admin-btn:hover {
    color: var(--amber);
  }

  .toolbar-divider {
    width: 1px;
    height: 16px;
    background: var(--border);
  }

  .project-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .project-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--bg-input);
    border-radius: 4px;
    font-size: 11px;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--red);
  }

  .connection-status.connected .status-dot {
    background: var(--green);
    box-shadow: 0 0 4px var(--green);
  }

  .status-text {
    color: var(--text-muted);
  }

  .connection-status.connected .status-text {
    color: var(--green);
  }

  .token-stats {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-dim);
  }

  .token-label {
    font-weight: 500;
    color: var(--text-muted);
  }

  .token-bar {
    width: 60px;
    height: 4px;
    background: var(--bg-input);
    border-radius: 2px;
    overflow: hidden;
  }

  .token-fill {
    height: 100%;
    background: var(--amber);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .token-value {
    font-family: var(--font-mono);
    min-width: 80px;
  }

  .online-users {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    background: var(--bg-input);
    border-radius: 4px;
  }

  .online-user-avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0,0,0,0.3);
    cursor: default;
    transition: transform 0.15s ease;
  }

  .online-user-avatar:hover {
    transform: scale(1.2);
  }

  .online-self {
    border: 1.5px solid var(--text-primary);
  }
</style>
