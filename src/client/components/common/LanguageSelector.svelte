<script>
  import { createEventDispatcher } from 'svelte';
  import Icon from '$components/common/Icon.svelte';
  import { currentLocale, setLocale } from '$lib/i18n.js';

  const dispatch = createEventDispatcher();

  const languages = [
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'en', name: 'English', flag: '🇺🇸' }
  ];

  function selectLanguage(code) {
    setLocale(code);
    dispatch('change', { locale: code });
  }
</script>

<div class="language-selector">
  <button class="lang-btn" title="选择语言">
    <Icon name="globe" size="md" />
    <span class="lang-text">{languages.find(l => l.code === $currentLocale)?.name}</span>
  </button>
  
  <div class="lang-dropdown">
    {#each languages as lang}
      <button 
        class="lang-option" 
        class:active={lang.code === $currentLocale}
        on:click={() => selectLanguage(lang.code)}
      >
        <span class="lang-flag">{lang.flag}</span>
        <span class="lang-name">{lang.name}</span>
        {#if lang.code === $currentLocale}
          <Icon name="check" size="sm" />
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .language-selector {
    position: relative;
    display: inline-block;
  }

  .lang-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s ease;
  }

  .lang-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-hover);
  }

  .lang-text {
    font-weight: 500;
  }

  .lang-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px;
    min-width: 140px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    opacity: 0;
    visibility: hidden;
    transform: translateY(-4px);
    transition: all 0.15s ease;
    z-index: 100;
  }

  .language-selector:hover .lang-dropdown,
  .language-selector:focus-within .lang-dropdown {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }

  .lang-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text-primary);
    cursor: pointer;
    font-size: 13px;
    text-align: left;
    transition: all 0.15s ease;
  }

  .lang-option:hover {
    background: var(--bg-hover);
  }

  .lang-option.active {
    background: var(--bg-accent-dim);
    color: var(--amber);
  }

  .lang-flag {
    font-size: 16px;
  }

  .lang-name {
    flex: 1;
    font-weight: 500;
  }
</style>
