/**
 * Models API - handles model discovery and configuration
 */

const BASE = '';

/**
 * Fetch available models for a provider
 */
export async function fetchModels(provider) {
  const url = provider
    ? `${BASE}/api/models?provider=${provider}`
    : `${BASE}/api/models`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch models');
  return res.json();
}

/**
 * Fetch server configuration
 */
export async function fetchConfig() {
  const res = await fetch(`${BASE}/api/config`);
  if (!res.ok) throw new Error('Failed to fetch config');
  return res.json();
}

/**
 * Fetch server health status
 */
export async function fetchHealth() {
  const res = await fetch(`${BASE}/api/health`);
  if (!res.ok) throw new Error('Failed to fetch health');
  return res.json();
}
