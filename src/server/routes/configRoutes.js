/**
 * Configuration & tools routes.
 * GET /api/tools     — available tool definitions
 * GET /api/config    — server configuration summary
 */
import { Router } from 'express';

export function createConfigRouter(deps) {
  const { getToolDefinitions, PROVIDERS, DEFAULTS, VERSION } = deps;
  const router = Router();

  router.get('/tools', (req, res) => {
    res.json({ tools: getToolDefinitions(process.env) });
  });

  router.get('/config', (req, res) => {
    const providers = {};
    for (const [p, cfg] of Object.entries(PROVIDERS)) {
      providers[p] = {
        baseUrl: cfg.baseUrl || null,
        fallbackModel: cfg.fallbackModel || null,
        modelCount: (cfg.models || []).length,
        aliasCount: Object.keys(cfg.modelAliases || {}).length
      };
    }
    res.json({ version: VERSION, defaults: DEFAULTS, providers });
  });

  return router;
}
