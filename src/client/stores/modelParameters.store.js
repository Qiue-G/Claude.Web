/**
 * Model Parameters Store
 * 管理模型参数（temperature, top_p, max_tokens 等）
 */
import { writable } from 'svelte/store';

const STORAGE_KEY = 'modelParameters';

const defaultParams = {
  // 基础参数
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 4096,
  frequencyPenalty: 0,
  presencePenalty: 0,
  // 高级参数
  topK: 40,
  seed: null,
  stop: '',
  stream: true
};

function loadParams() {
  if (typeof window === 'undefined') return { ...defaultParams };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultParams, ...JSON.parse(raw) } : { ...defaultParams };
  } catch {
    return { ...defaultParams };
  }
}

function saveParams(params) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {}
}

export const modelParameters = writable(loadParams());

modelParameters.subscribe((value) => {
  if (typeof window !== 'undefined') {
    saveParams(value);
  }
});

export function resetParameters() {
  modelParameters.set({ ...defaultParams });
}

export function getParameters() {
  let params = { ...defaultParams };
  modelParameters.subscribe(v => params = v)();
  return params;
}
