import { writable, derived } from 'svelte/store';

// 默认工具状态
const defaultTools = {
  web_search: false,
  code_interpreter: false,
  image_generation: false,
  file_analysis: false
};

// 工具状态存储
export const toolStates = writable({ ...defaultTools });

// 派生 store：返回已启用的工具 ID 列表
export const enabledTools = derived(toolStates, ($states) =>
  Object.entries($states)
    .filter(([, enabled]) => enabled)
    .map(([id]) => id)
);

/**
 * 更新单个工具状态
 */
export function setToolEnabled(id, enabled) {
  toolStates.update(states => ({ ...states, [id]: enabled }));
}

/**
 * 重置所有工具
 */
export function resetTools() {
  toolStates.set({ ...defaultTools });
}
