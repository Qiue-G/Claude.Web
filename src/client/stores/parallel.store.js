/**
 * Parallel Store — 并行模型对比状态管理
 */
import { writable, derived } from 'svelte/store';

/** 并行模式是否启用 */
export const parallelMode = writable(false);

/** 选中的模型列表 */
export const selectedModels = writable([]);

/** 并行运行是否激活 */
export const parallelRunning = writable(false);

/** 各模型的输出结果 */
export const parallelResults = writable({});

/** 并行运行摘要 */
export const parallelSummary = writable(null);

/** 错误信息 */
export const parallelError = writable(null);

/** 已完成的模型数量 */
export const completedModels = derived(parallelResults, ($results) => {
  return Object.values($results).filter(r => r.status === 'done').length;
});

/**
 * 重置所有并行状态
 */
export function resetParallel() {
  parallelResults.set({});
  parallelSummary.set(null);
  parallelError.set(null);
  parallelRunning.set(false);
}

/**
 * 添加模型输出块
 */
export function addParallelChunk(modelId, text) {
  parallelResults.update(results => {
    const existing = results[modelId] || { text: '', status: 'running', chunks: [] };
    existing.text += text;
    existing.chunks = [...(existing.chunks || []), { text, index: (existing.chunks?.length || 0) }];
    existing.status = 'running';
    results[modelId] = existing;
    return results;
  });
}

/**
 * 标记模型完成
 */
export function markModelDone(modelId, status, latency, tokens, error) {
  parallelResults.update(results => {
    const existing = results[modelId] || {};
    existing.status = status;
    existing.latency = latency;
    existing.tokens = tokens;
    existing.error = error;
    results[modelId] = existing;
    return results;
  });
}
