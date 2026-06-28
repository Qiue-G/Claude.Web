/**
 * Models API - handles model discovery and configuration
 */
import { api } from '$lib/api.js';

export async function fetchModels(provider) {
  const path = provider ? `/api/models?provider=${provider}` : '/api/models';
  return api.get(path);
}

export async function fetchConfig() {
  return api.get('/api/config');
}

export async function fetchHealth() {
  return api.get('/api/health', { noToast: true });
}
