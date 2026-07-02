<script>
  import { t } from '$lib/i18n.js';
  import { selectedModels, parallelMode } from '../../stores/parallel.store.js';

  let { models = [], disabled = false } = $props();

  function toggleModel(modelId) {
    selectedModels.update(list => {
      if (list.includes(modelId)) {
        return list.filter(id => id !== modelId);
      }
      if (list.length >= 4) {
        return list; // 最多 4 个
      }
      return [...list, modelId];
    });
  }

  function clearSelection() {
    selectedModels.set([]);
  }
</script>

{#if $parallelMode}
  <div class="model-multi-select">
    <div class="header">
      <span class="title">{$t('select_models_for_comparison')}</span>
      {#if $selectedModels.length > 0}
        <button class="clear-btn" onclick={clearSelection}>✕ {$t('clear')}</button>
      {/if}
    </div>
    <div class="model-list">
      {#each models as model}
        <button
          class="model-chip"
          class:selected={$selectedModels.includes(model.id)}
          disabled={disabled}
          onclick={() => toggleModel(model.id)}
        >
          <span class="checkbox">{#if $selectedModels.includes(model.id)}✓{/if}</span>
          <span class="name">{model.name || model.id}</span>
          {#if model.context}
            <span class="context">{Math.round(model.context / 1000)}K</span>
          {/if}
        </button>
      {/each}
    </div>
    {#if $selectedModels.length > 0}
      <div class="actions">
        <span class="selected-count">
          {$t('selected_count', { count: $selectedModels.length })}
          <button
            class="start-btn"
            disabled={$selectedModels.length < 2 || disabled}
            onclick={() => {
              // 触发并行开始的 WebSocket 消息在父组件中处理
              window.dispatchEvent(new CustomEvent('parallel-start-request'));
            }}
          >
            🚀 {$t('start_comparison')}
          </button>
        </span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .model-multi-select {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color, #333);
    background: var(--bg-secondary, #1a1a2e);
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .title {
    font-size: 12px;
    color: var(--text-secondary, #888);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .clear-btn {
    background: none;
    border: none;
    color: var(--text-muted, #666);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 6px;
  }
  .model-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .model-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border-color, #333);
    border-radius: 16px;
    background: var(--bg-primary, #0a0a0c);
    color: var(--text-primary, #eee);
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }
  .model-chip:hover {
    border-color: var(--accent-color, #6c5ce7);
  }
  .model-chip.selected {
    border-color: var(--accent-color, #6c5ce7);
    background: color-mix(in srgb, var(--accent-color, #6c5ce7) 15%, transparent);
  }
  .model-chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .checkbox {
    width: 16px;
    height: 16px;
    border: 1px solid var(--border-color, #444);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--accent-color, #6c5ce7);
  }
  .model-chip.selected .checkbox {
    background: var(--accent-color, #6c5ce7);
    color: #fff;
    border-color: var(--accent-color, #6c5ce7);
  }
  .name { font-weight: 500; }
  .context {
    font-size: 10px;
    color: var(--text-muted, #555);
    background: var(--bg-secondary, #1a1a2e);
    padding: 1px 5px;
    border-radius: 8px;
  }
  .actions {
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
  }
  .start-btn {
    padding: 4px 14px;
    border: none;
    border-radius: 6px;
    background: var(--accent-color, #6c5ce7);
    color: #fff;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    margin-left: 8px;
  }
  .start-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .selected-count {
    font-size: 12px;
    color: var(--text-secondary, #888);
  }
</style>
