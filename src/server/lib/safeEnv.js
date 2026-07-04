/**
 * Build a safe environment object for child processes.
 * Only whitelisted keys from process.env are included,
 * preventing accidental leakage of secrets (API keys, tokens, etc.).
 */
const SAFE_KEYS = ['PATH', 'HOME', 'TMP', 'TEMP', 'NODE_PATH', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'];

export function buildSafeEnv(extra = {}) {
  const env = {};
  for (const key of SAFE_KEYS) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const [k, v] of Object.entries(extra)) {
    env[k] = String(v);
  }
  return env;
}
