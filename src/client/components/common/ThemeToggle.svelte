<script>
  import { theme, setTheme, toggleTheme } from '$stores/theme.store.js';
  import Icon from '$components/common/Icon.svelte';
  import { t } from '$lib/i18n.js';

  const themes = [
    { value: 'dark', labelKey: 'theme.dark', icon: 'moon' },
    { value: 'light', labelKey: 'theme.light', icon: 'sun' },
    { value: 'system', labelKey: 'theme.system', icon: 'check' }
  ];

  function cycleTheme() {
    // 使用 store 的 toggleTheme 在 dark/light 间循环
    toggleTheme();
  }

  $: currentTheme = themes.find(t => t.value === $theme);
</script>

<button class="theme-toggle" on:click={cycleTheme} title={$t('theme.toggle')}>
  <Icon name={currentTheme?.icon} size="md" />
  <span class="theme-label">{$t(currentTheme?.labelKey || 'theme.dark')}</span>
</button>

<style>
  .theme-toggle {
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

  .theme-toggle:hover {
    background: var(--bg-hover);
    border-color: var(--border-hover);
  }

  .theme-label {
    font-weight: 500;
  }
</style>
