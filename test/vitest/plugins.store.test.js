// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  pluginsConfig,
  registeredToolbarItems,
  registeredCommands,
  getEnabledTokens,
  applyThemeTokens,
  togglePlugin,
  initPlugins
} from '../../src/client/stores/plugins.store.js';
import { get } from 'svelte/store';

const mockConfig = {
  starlight: {
    enabled: true,
    type: 'theme',
    manifest: {
      name: '星夜主题',
      toolbarButtons: [{ slot: 'right', label: '切换星夜', icon: 'star', command: 'starlight:toggle' }],
      commands: [{ id: 'starlight:toggle', name: '切换星夜主题', description: '测试' }],
      tokens: {
        light: { '--ds-accent': '#7a5fd0' },
        dark: { '--ds-accent': '#a78ff0' }
      }
    }
  },
  disabledPlugin: {
    enabled: false,
    type: 'theme',
    manifest: {
      toolbarButtons: [{ slot: 'right', label: '不会出现', command: 'noop' }],
      commands: [{ id: 'noop', name: '不应出现' }]
    }
  }
};

describe('plugins.store', () => {
  beforeEach(() => {
    pluginsConfig.set(mockConfig);
  });

  it('initPlugins sets config', () => {
    const fresh = { test: { enabled: true } };
    initPlugins(fresh);
    expect(get(pluginsConfig)).toEqual(fresh);
  });

  it('initPlugins ignores non-object', () => {
    pluginsConfig.set(mockConfig);
    initPlugins(null);
    expect(get(pluginsConfig)).toEqual(mockConfig);
  });

  it('derives toolbar items from enabled plugins only', () => {
    const items = get(registeredToolbarItems);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('切换星夜');
  });

  it('derives commands from enabled plugins only', () => {
    const cmds = get(registeredCommands);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].id).toBe('starlight:toggle');
    expect(cmds[0].isPlugin).toBe(true);
  });

  it('merges tokens by theme', () => {
    const light = getEnabledTokens('light', mockConfig);
    expect(light['--ds-accent']).toBe('#7a5fd0');
    const dark = getEnabledTokens('dark', mockConfig);
    expect(dark['--ds-accent']).toBe('#a78ff0');
  });

  it('returns empty for disabled plugin tokens', () => {
    const cfg = { starlight: { ...mockConfig.starlight, enabled: false } };
    expect(getEnabledTokens('light', cfg)).toEqual({});
  });

  it('injects and removes theme style element', () => {
    applyThemeTokens({ '--test': 'red' });
    const el = document.getElementById('plugin-theme-tokens');
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('--test: red;');

    applyThemeTokens(null);
    expect(document.getElementById('plugin-theme-tokens')).toBeNull();
  });

  it('togglePlugin flips enabled state', () => {
    expect(get(pluginsConfig).starlight.enabled).toBe(true);
    togglePlugin('starlight');
    expect(get(pluginsConfig).starlight.enabled).toBe(false);
    togglePlugin('starlight');
    expect(get(pluginsConfig).starlight.enabled).toBe(true);
  });

  it('togglePlugin ignores unknown id', () => {
    togglePlugin('nonexistent');
    // should not throw
  });
});
