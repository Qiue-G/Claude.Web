/**
 * Filters 注册中心
 *
 * 内置过滤器列表，供 filterPipeline.js 和 wsHandler 使用。
 * 每个 filter 关联 agent-config.json 中的 filters 配置。
 */

import { contextInjectFilter } from './contextInject.js';
import { profanityFilter } from './profanity.js';
import { formatGuardFilter } from './formatGuard.js';

/** 所有内置 filter 定义 */
export const BUILTIN_FILTERS = {
  contextInject: contextInjectFilter,
  profanity: profanityFilter,
  formatGuard: formatGuardFilter
};

/**
 * 根据配置构建可执行的 filter 列表（按顺序）
 * @param {object} filtersConfig - agent-config.json 的 filters 字段 { id: { enabled, ...options } }
 * @returns {object[]} 排序后的 filter 数组 [{ id, enabled, handler, ...options }]
 */
export function buildFilterList(filtersConfig = {}) {
  const order = ['contextInject', 'profanity', 'formatGuard'];

  return order
    .map((id) => {
      const cfg = filtersConfig[id];
      // 默认启用
      const enabled = cfg === undefined ? true : !!cfg.enabled;
      const builtin = BUILTIN_FILTERS[id];
      if (!builtin) return null;
      return {
        id,
        enabled,
        handler: builtin.handler,
        type: builtin.type,
        ...(cfg && typeof cfg === 'object' ? cfg : {}),
        handler: builtin.handler // 防止被 cfg 覆盖
      };
    })
    .filter(Boolean);
}

/**
 * 获取每个 filter 的元信息（用于前端展示）
 */
export function getFilterMeta() {
  return Object.entries(BUILTIN_FILTERS).map(([id, f]) => ({
    id,
    name: f.name,
    description: f.description,
    type: f.type,
    inputOnly: f.type === 'input',
    outputOnly: f.type === 'output'
  }));
}