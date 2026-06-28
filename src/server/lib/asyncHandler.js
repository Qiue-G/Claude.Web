/**
 * asyncHandler — wraps an async Express route handler so thrown errors
 * (including AppError) are forwarded to the Express error middleware.
 *
 * Usage:
 *   import { asyncHandler } from './lib/asyncHandler.js';
 *   router.get('/foo', asyncHandler(async (req, res) => {
 *     const data = await riskyOperation();
 *     res.json(data);
 *   }));
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
