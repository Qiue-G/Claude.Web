/**
 * Filters store — 管理过滤器配置状态
 */

import { writable, derived } from 'svelte/store';

/** 原始过滤器配置（从 /api/config 获取） */
export const filtersConfig = writable({});

/** 当前是否启用 contextInject 过滤器 */
export const contextInjectEnabled = derived(filtersConfig, ($cfg) => {
  return $cfg.contextInject?.enabled !== false;
});

/** 当前是否启用 profanity 过滤器 */
export const profanityEnabled = derived(filtersConfig, ($cfg) => {
  return $cfg.profanity?.enabled !== false;
});

/** 当前是否启用 formatGuard 过滤器 */
export const formatGuardEnabled = derived(filtersConfig, ($cfg) => {
  return $cfg.formatGuard?.enabled !== false;
});

/** 所有过滤器的元信息 */
export const filterMeta = derived(filtersConfig, ($cfg) => {
  return [
    {
      id: 'contextInject',
      name: '上下文注入',
      description: '自动检索知识库并将相关文档注入到提示词上下文',
      enabled: $cfg.contextInject?.enabled !== false,
      config: $cfg.contextInject || {}
    },
    {
      id: 'profanity',
      name: '内容审查',
      description: '检查 AI 输出中的敏感/不当内容',
      enabled: $cfg.profanity?.enabled !== false,
      config: $cfg.profanity || {}
    },
    {
      id: 'formatGuard',
      name: '格式校验',
      description: '确保 AI 输出符合格式要求（截断/闭合代码块等）',
      enabled: $cfg.formatGuard?.enabled !== false,
      config: $cfg.formatGuard || {}
    }
  ];
});

/** 更新过滤器配置（目前仅支持开关切换，后续可扩展） */
export function setFilterEnabled(id, enabled) {
  filtersConfig.update((cfg) => {
    if (!cfg[id]) cfg[id] = {};
    cfg[id].enabled = enabled;
    return { ...cfg };
  });
}

/** 初始化过滤器配置 */
export function initFilters(config) {
  if (config) {
    filtersConfig.set(config);
  }
}