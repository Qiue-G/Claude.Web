/**
 * Theme Store - manages application theme (dark/light/system)
 */
import { writable, derived } from 'svelte/store';
import { browser } from '$lib/browser.js';

const STORAGE_KEY = 'appTheme';

function getInitialTheme() {
  if (!browser) return 'dark';
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ['dark', 'light', 'system'].includes(stored)) {
      return stored;
    }
  } catch {}
  
  return 'dark';
}

function getSystemTheme() {
  if (!browser) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const theme = writable(getInitialTheme());

// 系统主题变化的响应式触发器
export const systemTheme = writable(browser ? getSystemTheme() : 'dark');

export const effectiveTheme = derived([theme, systemTheme], ([$theme, $systemTheme]) => {
  if ($theme === 'system') {
    return $systemTheme;
  }
  return $theme;
});

// Save theme preference
theme.subscribe((value) => {
  if (browser) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {}
  }
});

// Apply theme to document
effectiveTheme.subscribe((value) => {
  if (browser) {
    document.documentElement.setAttribute('data-theme', value);
  }
});

// Listen for system theme changes
if (browser) {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (e) => {
    systemTheme.set(e.matches ? 'dark' : 'light');
  });
}

export function setTheme(newTheme) {
  theme.set(newTheme);
}

export function toggleTheme() {
  theme.update(current => {
    if (current === 'dark') return 'light';
    if (current === 'light') return 'system';
    return 'dark';
  });
}
