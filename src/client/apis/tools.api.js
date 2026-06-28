/**
 * API wrappers for built-in tool endpoints.
 */
import { api } from '$lib/api.js';

export async function fetchTools() {
  return api.get('/api/tools');
}
