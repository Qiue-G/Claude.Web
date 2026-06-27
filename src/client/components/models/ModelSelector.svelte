<script>
  import { createEventDispatcher } from 'svelte';
  import Icon from '$components/common/Icon.svelte';
  import { savedModels, activeModelId } from '$stores/models.store.js';
  import { isConnected } from '$stores/session.store.js';
  import { t } from '$lib/i18n.js';

  const dispatch = createEventDispatcher();

  let isOpen = false;
  let selectorElement;

  function toggle() {
    isOpen = !isOpen;
  }

  function selectModel(model) {
    dispatch('select', model);
    isOpen = false;
  }

  function openConfig() {
    dispatch('openConfig');
    isOpen = false;
  }

  function handleClickOutside(event) {
    if (selectorElement && !selectorElement.contains(event.target)) {
      isOpen = false;
    }
  }

  $: activeModel = $savedModels.find(m => m.id === $activeModelId);
  $: displayName = activeModel ? activeModel.name : $t('model.select');
</script>

<svelte:window on:click={handleClickOutside} />

<div class="model-selector" bind:this={selectorElement}>
  <button class="selector-trigger" on:click={toggle}>
    <span class="model-name">{displayName}</span>
    <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size="sm" />
  </button>

  {#if isOpen}
    <div class="selector-dropdown">
      <div class="dropdown-section">
        <div class="section-title">{$t('model.available')}</div>
        {#each $savedModels as model}
          <button
            class="model-option"
            class:active={model.id === $activeModelId}
            on:click={() => selectModel(model)}
          >
            <span class="model-name">{model.name}</span>
            {#if model.id === $activeModelId && $isConnected}
              <span class="status-dot connected"></span>
            {/if}
          </button>
        {/each}
        {#if $savedModels.length === 0}
          <div class="empty-state">{$t('model.noModels')}</div>
        {/if}
      </div>

      <div class="dropdown-divider"></div>

      <button class="config-button" on:click={openConfig}>
        <Icon name="settings" size="sm" />
        <span>{$t('model.configure')}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .model-selector {
    position: relative;
  }

  .selector-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    font-family: var(--font-sans);
    transition: all 0.15s ease;
  }

  .selector-trigger:hover {
    background: var(--bg-hover);
    border-color: var(--border-hover);
    color: var(--text-primary);
  }

  .model-name {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selector-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 240px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 100;
    animation: dropdownFadeIn 0.15s ease;
  }

  .dropdown-section {
    padding: 8px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-dim);
    padding: 4px 8px 8px;
  }

  .model-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 10px;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
    font-family: var(--font-sans);
    text-align: left;
    transition: background 0.15s ease;
  }

  .model-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .model-option.active {
    background: var(--bg-accent-dim2);
    color: var(--amber-bright);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-dim);
  }

  .status-dot.connected {
    background: var(--green);
    box-shadow: 0 0 4px var(--green);
  }

  .empty-state {
    padding: 12px;
    text-align: center;
    color: var(--text-dim);
    font-size: 12px;
  }

  .dropdown-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .config-button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
    font-family: var(--font-sans);
    text-align: left;
    transition: background 0.15s ease;
  }

  .config-button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  @keyframes dropdownFadeIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
