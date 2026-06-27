<script>
  import { createEventDispatcher } from 'svelte';
  import Icon from '$components/common/Icon.svelte';
  import { savedModels, activeModelId } from '$stores/models.store.js';
  import { isConnected } from '$stores/session.store.js';
  import { t } from '$lib/i18n.js';

  const dispatch = createEventDispatcher();

  function handleSwitch(model) {
    dispatch('switch', model);
  }

  function handleDelete(model) {
    dispatch('delete', model);
  }

  function handleEdit(model) {
    dispatch('edit', model);
  }
</script>

<div class="model-list">
  {#each $savedModels as model}
    <div class="model-item" class:active={model.id === $activeModelId}>
      <div class="model-info">
        <div class="model-name">{model.name}</div>
        <div class="model-details">
          <span class="provider">{model.provider}</span>
          <span class="separator">·</span>
          <span class="model-id">{model.model}</span>
        </div>
      </div>

      <div class="model-actions">
        {#if model.id === $activeModelId && $isConnected}
          <span class="status-badge active">{$t('model.using')}</span>
        {:else if model.id === $activeModelId}
          <span class="status-badge connecting">{$t('model.connecting')}</span>
        {/if}

        <button
          class="action-btn"
          on:click={() => handleEdit(model)}
          title={$t('model.edit')}
        >
          <Icon name="edit" size="sm" />
        </button>

        {#if model.id !== $activeModelId}
          <button
            class="action-btn primary"
            on:click={() => handleSwitch(model)}
            title={$t('model.switch')}
          >
            <Icon name="check" size="sm" />
          </button>
        {/if}

        <button
          class="action-btn danger"
          on:click={() => handleDelete(model)}
          title={$t('model.delete')}
        >
          <Icon name="trash" size="sm" />
        </button>
      </div>
    </div>
  {/each}

  {#if $savedModels.length === 0}
    <div class="empty-state">
      <Icon name="inbox" size="lg" />
      <p>{$t('model.noModels')}</p>
      <p class="hint">{$t('model.addModel')}</p>
    </div>
  {/if}
</div>

<style>
  .model-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
  }

  .model-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    transition: all 0.15s ease;
  }

  .model-item:hover {
    background: var(--bg-hover);
    border-color: var(--border-hover);
  }

  .model-item.active {
    background: var(--bg-accent-dim);
    border-color: var(--amber);
  }

  .model-info {
    flex: 1;
    min-width: 0;
  }

  .model-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .model-details {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .provider {
    color: var(--text-muted);
  }

  .separator {
    color: var(--text-dim);
  }

  .model-id {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-badge {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
  }

  .status-badge.active {
    background: rgba(34, 197, 94, 0.15);
    color: var(--green);
  }

  .status-badge.connecting {
    background: rgba(217, 119, 6, 0.15);
    color: var(--amber);
  }

  .action-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .action-btn:hover {
    background: var(--bg-accent-dim);
    border-color: var(--border-hover);
    color: var(--text-primary);
  }

  .action-btn.primary:hover {
    background: var(--bg-accent-dim2);
    color: var(--amber-bright);
  }

  .action-btn.danger:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: var(--red);
    color: var(--red);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 32px 16px;
    color: var(--text-dim);
    text-align: center;
  }

  .empty-state p {
    margin: 0;
    font-size: 13px;
  }

  .empty-state .hint {
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
