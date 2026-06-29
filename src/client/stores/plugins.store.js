/**
 * Plugins Store — 轻量扩展点数据层
 *
 * 从 /api/config 的 plugins 字段加载配置，驱动：
 * - 工具栏按钮渲染
 * - 命令面板条目
 * - 主题令牌注入
 * - Agent 钩子（前端侧仅暴露 enable/disable）
 *
 * 所有"插件"本质是配置数据，不需要独立目录/加载器/生命周期。
 */
import { writable, derived } from 'svelte/store';

/** 原始插件配置（从 /api/config 同步） */
export const pluginsConfig = writable({});

/** 初始化/更新插件配置 */
export function initPlugins(configData) {
  if (configData && typeof configData === 'object') {
    pluginsConfig.set(configData);
  }
}

/** 切换插件的 enabled 状态 */
export function togglePlugin(id) {
  pluginsConfig.update(cfg => {
    if (cfg[id]) {
      return { ...cfg, [id]: { ...cfg[id], enabled: !cfg[id].enabled } };
    }
    return cfg;
  });
}

/** 已启用的工具栏按钮 */
export const registeredToolbarItems = derived(pluginsConfig, ($cfg) => {
  const items = [];
  for (const plugin of Object.values($cfg)) {
    if (!plugin.enabled) continue;
    if (plugin.manifest?.toolbarButtons) {
      items.push(...plugin.manifest.toolbarButtons);
    }
  }
  return items;
});

/** 已启用的命令面板条目 */
export const registeredCommands = derived(pluginsConfig, ($cfg) => {
  const cmds = [];
  for (const plugin of Object.values($cfg)) {
    if (!plugin.enabled) continue;
    if (plugin.manifest?.commands) {
      cmds.push(...plugin.manifest.commands.map(c => ({ ...c, isPlugin: true })));
    }
  }
  return cmds;
});

/**
 * 获取指定主题下的所有已启用插件令牌
 * @param {'light'|'dark'} theme
 * @param {object} config - pluginsConfig 的当前值
 * @returns {object} 合并后的 CSS 变量键值对
 */
export function getEnabledTokens(theme, config) {
  const tokens = {};
  for (const plugin of Object.values(config)) {
    if (!plugin.enabled) continue;
    if (plugin.manifest?.tokens?.[theme]) {
      Object.assign(tokens, plugin.manifest.tokens[theme]);
    }
  }
  return tokens;
}

/** 当前活动的令牌 <style> 元素引用 */
let tokenStyleEl = null;

/**
 * 将 CSS 变量注入到 document.head
 * @param {object|null} tokens - CSS 变量键值对，传 null 移除
 */
export function applyThemeTokens(tokens) {
  if (tokenStyleEl) {
    tokenStyleEl.remove();
    tokenStyleEl = null;
  }
  if (!tokens || Object.keys(tokens).length === 0) return;

  const entries = Object.entries(tokens);
  const css = ':root {\n' + entries.map(([k, v]) => `  ${k}: ${v};`).join('\n') + '\n}';
  const el = document.createElement('style');
  el.id = 'plugin-theme-tokens';
  el.textContent = css;
  document.head.appendChild(el);
  tokenStyleEl = el;
}

/**
 * 执行插件命令
 * 命令以 "<pluginId>:<action>" 格式命名
 */
export function executeCommand(commandId) {
  if (!commandId || typeof commandId !== 'string') return;
  const [pluginId, action] = commandId.split(':');

  switch (`${pluginId}:${action}`) {
    case 'starlight:toggle':
      togglePlugin('starlight');
      break;
    default:
      console.warn(`[plugins] unknown command: ${commandId}`);
  }
}
