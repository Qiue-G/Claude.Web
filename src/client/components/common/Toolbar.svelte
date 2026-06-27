<script>
  import { createEventDispatcher } from 'svelte';
  import Icon from '$components/common/Icon.svelte';
  import ModelSelector from '$components/models/ModelSelector.svelte';
  import ThemeToggle from '$components/common/ThemeToggle.svelte';
  import LanguageSelector from '$components/common/LanguageSelector.svelte';
  import { connectionStatus } from '$stores/session.store.js';
  import { tokenStats } from '$stores/chat.store.js';
  import { t } from '$lib/i18n.js';

  const dispatch = createEventDispatcher();

  function handleToggleSidebar() {
    dispatch('toggleSidebar');
  }

  function handleOpenConfig() {
    dispatch('openConfig');
  }

  function handleModelSelect(e) {
    const model = e.detail;
    dispatch('selectModel', model);
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
    <button class="toolbar-btn" on:click={handleToggleSidebar} title="切换侧边栏">
      <Icon name="menu" size="md" />
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

    {#if $tokenStats.input > 0}
      <div class="token-stats" title="Token 使用情况">
        <span class="token-label">Tokens</span>
        <div class="token-bar">
          <div class="token-fill" style="width: {Math.min(tokenPct, 100)}%"></div>
        </div>
        <span class="token-value">{formatTokens($tokenStats.input)} / {formatTokens($tokenStats.inputMax)}</span>
      </div>
    {/if}
  </div>

  <div class="toolbar-right">
    <ThemeToggle />
    <LanguageSelector />
    <ModelSelector
      on:select={handleModelSelect}
      on:openConfig={handleOpenConfig}
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
</style>
