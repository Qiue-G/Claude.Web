<script>
  import { createEventDispatcher } from 'svelte';

  let {
    title = '',
    subtitle = '',
    icon = '\u2699',
    suggestions = []
  } = $props();

  const dispatch = createEventDispatcher();

  function handleSuggestionClick(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    dispatch('suggestion', text);
  }
</script>

<div class="chat-placeholder" role="region" aria-label="welcome">
  <div class="placeholder-content">
    <div class="placeholder-icon" aria-hidden="true">{icon}</div>
    {#if title}<h2 class="placeholder-title">{title}</h2>{/if}
    {#if subtitle}<p class="placeholder-subtitle">{subtitle}</p>{/if}
    {#if suggestions.length > 0}
      <div class="suggestion-grid">
        {#each suggestions as suggestion}
          <button type="button" class="suggestion-card" data-text={suggestion.text} onclick={handleSuggestionClick}>
            {#if suggestion.icon}<span class="suggestion-icon" aria-hidden="true">{suggestion.icon}</span>{/if}
            <span class="suggestion-label">{suggestion.label}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .chat-placeholder { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; min-height: 100%; padding: 24px; }
  .placeholder-content { display: flex; flex-direction: column; align-items: center; max-width: 640px; width: 100%; text-align: center; }
  .placeholder-icon { font-size: 48px; margin-bottom: 16px; color: var(--amber, #f59e0b); opacity: 0.6; animation: logoFloat 3s ease-in-out infinite; line-height: 1; }
  .placeholder-title { font-size: 20px; font-weight: 600; color: var(--text-primary); margin: 0 0 6px; line-height: 1.3; }
  .placeholder-subtitle { font-size: 14px; color: var(--text-dim); margin: 0 0 28px; line-height: 1.5; }
  .suggestion-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; width: 100%; }
  .suggestion-card { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; color: var(--text-secondary); cursor: pointer; font-size: 13px; font-family: var(--font-sans, inherit); text-align: left; transition: all 0.15s ease; }
  .suggestion-card:hover { background: var(--bg-hover); border-color: var(--border-hover); color: var(--text-primary); transform: translateY(-1px); }
  .suggestion-card:focus-visible { outline: 2px solid var(--amber, #f59e0b); outline-offset: 1px; }
  .suggestion-card:active { transform: translateY(0); }
  .suggestion-icon { font-size: 16px; flex-shrink: 0; }
  .suggestion-label { flex: 1; min-width: 0; line-height: 1.4; }
  @keyframes logoFloat { 0%, 100% { transform: translateY(0); opacity: 0.6; } 50% { transform: translateY(-6px); opacity: 0.8; } }
</style>
