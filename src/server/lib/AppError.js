/**
 * AppError — unified application error with HTTP status code and optional metadata.
 *
 * Usage:
 *   throw new AppError(400, 'Invalid API key');
 *   throw new AppError(429, 'Too many requests', { retryAfter: 60 });
 *   throw new AppError(500, 'Internal error', { cause: originalError });
 */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message Human-readable error message
   * @param {object} [extra] Additional fields merged into JSON response
   *   @param {string} [extra.code] Machine-readable error code (default: derived from status)
   *   @param {number} [extra.retryAfter] Retry-After seconds for 429
   *   @param {Error} [extra.cause] Original error chain
   */
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    if (extra.cause) this.cause = extra.cause;
    this.extra = extra;
  }

  /** Convert to JSON response body */
  toJSON() {
    const body = {
      error: this.message,
      code: this.extra.code || errorCodeForStatus(this.status)
    };
    if (this.extra.retryAfter != null) body.retryAfter = this.extra.retryAfter;
    return body;
  }
}

function errorCodeForStatus(status) {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'payload_too_large';
  if (status === 429) return 'rate_limited';
  return 'internal_error';
}
