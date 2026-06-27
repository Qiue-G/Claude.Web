/**
 * Session Store - manages session and connection state
 */
import { writable } from 'svelte/store';

const STORAGE_KEY_SID = 'sessionId';
const STORAGE_KEY_TOKEN = 'sessionToken';
const STORAGE_KEY_CSRF = 'csrfToken';

function loadStored(key) {
  try { return localStorage.getItem(key) || null; } catch { return null; }
}

export const sessionId = writable(loadStored(STORAGE_KEY_SID));
export const sessionToken = writable(loadStored(STORAGE_KEY_TOKEN));
export const csrfToken = writable(loadStored(STORAGE_KEY_CSRF));
export const isConnected = writable(false);
export const connectionStatus = writable('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'error'

sessionId.subscribe(val => {
  try { val ? localStorage.setItem(STORAGE_KEY_SID, val) : localStorage.removeItem(STORAGE_KEY_SID); } catch {}
});
sessionToken.subscribe(val => {
  try { val ? localStorage.setItem(STORAGE_KEY_TOKEN, val) : localStorage.removeItem(STORAGE_KEY_TOKEN); } catch {}
});
csrfToken.subscribe(val => {
  try { val ? localStorage.setItem(STORAGE_KEY_CSRF, val) : localStorage.removeItem(STORAGE_KEY_CSRF); } catch {}
});
