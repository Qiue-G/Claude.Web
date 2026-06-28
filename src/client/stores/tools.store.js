import { writable, derived } from 'svelte/store';

// 默认工具状态
const defaultTools = {
  web_search: false,
  code_interpreter: false,
  image_generation: false,
  file_analysis: false
};

export const availableTools = writable([]);

// 工具状态存储
export const toolStates = writable({ ...defaultTools });

// 派生 store：返回已启用的工具 ID 列表
export const enabledTools = derived(toolStates, ($states) =>
  Object.entries($states)
    .filter(([, enabled]) => enabled)
    .map(([id]) => id)
);

/**
 * 更新后端可用工具列表，并自动关闭未配置工具
 */
export function setAvailableTools(tools) {
  availableTools.set(tools);
  const configured = new Set(tools.filter(tool => tool.configured).map(tool => tool.id));
  toolStates.update(states => {
    const next = { ...states };
    for (const id of Object.keys(next)) {
      if (!configured.has(id)) next[id] = false;
    }
    return next;
  });
}

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
