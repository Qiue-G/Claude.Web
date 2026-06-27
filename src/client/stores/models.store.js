/**
 * Models Store - manages model configuration and state
 */
import { writable, derived } from 'svelte/store';

const STORAGE_KEY_MODELS = 'savedModels';
const STORAGE_KEY_ACTIVE = 'activeModelId';

function loadFromStorage(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : fallback;
  } catch { return fallback; }
}

export const savedModels = writable(loadFromStorage(STORAGE_KEY_MODELS, []));
export const activeModelId = writable(loadFromStorage(STORAGE_KEY_ACTIVE, ''));

savedModels.subscribe(val => {
  try { localStorage.setItem(STORAGE_KEY_MODELS, JSON.stringify(val)); } catch {}
});

activeModelId.subscribe(val => {
  try { localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(val)); } catch {}
});

export const activeModel = derived(
  [savedModels, activeModelId],
  ([$savedModels, $activeModelId]) => $savedModels.find(m => m.id === $activeModelId) || null
);

export function addModel(model) {
  savedModels.update(models => [...models, { ...model, id: 'model_' + Date.now() }]);
}

export function removeModel(modelId) {
  savedModels.update(models => models.filter(m => m.id !== modelId));
  activeModelId.update(id => id === modelId ? '' : id);
}

export function switchModel(modelId) {
  activeModelId.set(modelId);
}
