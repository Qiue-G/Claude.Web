/**
 * Structured logger — JSON lines to stdout, compatible with log aggregators.
 *
 * Usage:
 *   import { logger } from './lib/logger.js';
 *   logger.info('Server started', { port: 3000 });
 *   logger.error('DB error', { error: err.message });
 *   logger.debug('Request', { method: 'GET', path: '/api/health' });
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LOG_LEVEL = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function format(level, message, meta = {}) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...meta
  });
}

export const logger = {
  debug(message, meta) {
    if (LOG_LEVEL <= LEVELS.debug) console.log(format('debug', message, meta));
  },
  info(message, meta) {
    if (LOG_LEVEL <= LEVELS.info) console.log(format('info', message, meta));
  },
  warn(message, meta) {
    if (LOG_LEVEL <= LEVELS.warn) console.warn(format('warn', message, meta));
  },
  error(message, meta) {
    if (LOG_LEVEL <= LEVELS.error) console.error(format('error', message, meta));
  },
};
