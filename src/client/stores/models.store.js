/**
 * Models Store - manages model configuration and state
 */
import { writable, derived } from 'svelte/store';

const STORAGE_KEY_MODELS = 'savedModels';
const STORAGE_KEY_ACTIVE = 'activeModelId';
const SESSION_API_KEY_PREFIX = 'modelApiKey:';

function loadFromStorage(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : fallback;
  } catch { return fallback; }
}

function stripApiKeys(models) {
  return Array.isArray(models)
    ? models.map(({ apiKey, ...model }) => model)
    : [];
}

function getSessionApiKey(modelId) {
  try { return sessionStorage.getItem(SESSION_API_KEY_PREFIX + modelId) || ''; } catch { return ''; }
}

function setSessionApiKey(modelId, apiKey) {
  try {
    if (apiKey) sessionStorage.setItem(SESSION_API_KEY_PREFIX + modelId, apiKey);
  } catch {}
}

function removeSessionApiKey(modelId) {
  try { sessionStorage.removeItem(SESSION_API_KEY_PREFIX + modelId); } catch {}
}

function restoreSessionApiKeys(models) {
  return stripApiKeys(models).map(model => {
    const apiKey = getSessionApiKey(model.id);
    return apiKey ? { ...model, apiKey } : model;
  });
}

export const savedModels = writable(restoreSessionApiKeys(loadFromStorage(STORAGE_KEY_MODELS, [])));
export const activeModelId = writable(loadFromStorage(STORAGE_KEY_ACTIVE, ''));

savedModels.subscribe(val => {
  try { localStorage.setItem(STORAGE_KEY_MODELS, JSON.stringify(stripApiKeys(val))); } catch {}
});

activeModelId.subscribe(val => {
  try { localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(val)); } catch {}
});

export const activeModel = derived(
  [savedModels, activeModelId],
  ([$savedModels, $activeModelId]) => $savedModels.find(m => m.id === $activeModelId) || null
);

export function addModel(model) {
  const id = 'model_' + Date.now();
  setSessionApiKey(id, model.apiKey);
  savedModels.update(models => [...models, { ...model, id }]);
}

export function updateModel(modelId, updates) {
  removeSessionApiKey(modelId);
  setSessionApiKey(modelId, updates.apiKey);
  savedModels.update(models => models.map(m => m.id === modelId ? { ...m, ...updates, id: modelId } : m));
}

export function removeModel(modelId) {
  removeSessionApiKey(modelId);
  savedModels.update(models => models.filter(m => m.id !== modelId));
  activeModelId.update(id => id === modelId ? '' : id);
}

export function switchModel(modelId) {
  activeModelId.set(modelId);
}
