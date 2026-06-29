/**
 * Configuration & tools routes.
 * GET /api/tools     — available tool definitions (built-in + MCP)
 * GET /api/config    — server configuration summary
 * GET /api/config/mcp — MCP server status
 */
import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';

export function createConfigRouter(deps) {
  const { getToolDefinitions, PROVIDERS, DEFAULTS, VERSION, mcpManager, agentConfig } = deps;
  const router = Router();

  router.get('/tools', asyncHandler(async (req, res) => {
    let mcpTools = [];
    if (mcpManager && mcpManager.isConnected()) {
      try {
        mcpTools = await mcpManager.listTools();
      } catch (e) {
        console.warn('[CONFIG] mcp listTools failed:', e.message);
      }
    }
    const builtin = getToolDefinitions(process.env);
    res.json({ tools: [...builtin, ...mcpTools] });
  }));

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
    res.json({ version: VERSION, defaults: DEFAULTS, providers, plugins: agentConfig.plugins || {} });
  });

  router.get('/config/mcp', (req, res) => {
    const servers = [];
    if (mcpManager) {
      for (const name of mcpManager.getServerNames()) {
        servers.push({ name, connected: true });
      }
    }
    res.json({ servers });
  });

  return router;
}
