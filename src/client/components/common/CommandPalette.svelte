<script>
  import { onMount, onDestroy } from 'svelte';
  import { isCommandPaletteOpen, commands, closeCommandPalette, executeCommand } from '$stores/keyboard.store.js';
  import Icon from '$components/common/Icon.svelte';
  import { t } from '$lib/i18n.js';

  let searchQuery = '';
  let selectedIndex = 0;
  let inputElement;

  $: filteredCommands = $commands.filter(cmd => 
    cmd.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    cmd.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  $: if ($isCommandPaletteOpen) {
    searchQuery = '';
    selectedIndex = 0;
    setTimeout(() => inputElement?.focus(), 50);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandPalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % filteredCommands.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        executeCommand(filteredCommands[selectedIndex].id);
      }
    }
  }

  function handleCommandClick(commandId) {
    executeCommand(commandId);
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      closeCommandPalette();
    }
  }
</script>

{#if $isCommandPaletteOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="command-palette-backdrop" on:click={handleBackdropClick} on:keydown={handleKeydown}>
    <div class="command-palette">
      <div class="search-container">
        <Icon name="search" size="md" />
        <input
          bind:this={inputElement}
          bind:value={searchQuery}
          placeholder={$t('command.search')}
          on:keydown={handleKeydown}
        />
      </div>

      <div class="commands-list">
        {#each filteredCommands as command, index}
          <button
            class="command-item"
            class:selected={index === selectedIndex}
            on:click={() => handleCommandClick(command.id)}
          >
            <div class="command-info">
              <div class="command-name">{$t(command.nameKey) || command.name}</div>
              <div class="command-description">{$t(command.descriptionKey) || command.description}</div>
            </div>
            <div class="command-shortcut">{command.shortcut}</div>
          </button>
        {:else}
          <div class="no-results">{$t('command.noResults')}</div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .command-palette-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    z-index: 1000;
    animation: fadeIn 0.15s ease-out;
  }

  .command-palette {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 90%;
    max-width: 600px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    animation: slideDown 0.2s ease-out;
  }

  .search-container {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }

  .search-container input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 16px;
  }

  .search-container input::placeholder {
    color: var(--text-dim);
  }

  .commands-list {
    overflow-y: auto;
    padding: 8px;
  }

  .command-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    background: transparent;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background 0.1s;
  }

  .command-item:hover,
  .command-item.selected {
    background: var(--bg-hover);
  }

  .command-info {
    flex: 1;
    min-width: 0;
  }

  .command-name {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 2px;
  }

  .command-description {
    color: var(--text-dim);
    font-size: 12px;
  }

  .command-shortcut {
    color: var(--text-dim);
    font-size: 12px;
    font-family: var(--font-mono);
    background: var(--bg-base);
    padding: 4px 8px;
    border-radius: 4px;
    white-space: nowrap;
  }

  .no-results {
    padding: 32px;
    text-align: center;
    color: var(--text-dim);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes slideDown {
    from {
      transform: translateY(-20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
</style>
