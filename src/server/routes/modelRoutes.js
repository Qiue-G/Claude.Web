/**
 * Model discovery routes.
 * GET /api/models               — list models for default provider
 * GET /api/models/:provider     — list models for specific provider
 */
import { Router } from 'express';

export function createModelRouter(deps) {
  const { getProviderConfig, DEFAULTS } = deps;
  const router = Router();

  function sortModels(models) {
    return [...models].sort((a, b) => {
      if (a.tier !== b.tier) return a.tier === 'free' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  router.get('/', (req, res) => {
    const provider = req.query.provider || DEFAULTS.provider;
    const cfg = getProviderConfig(provider);
    const models = cfg.models || [];
    res.json({
      provider,
      models: sortModels(models),
      fallback: cfg.fallbackModel || null
    });
  });

  // POST /api/models/recommend — 智能模型推荐
  router.post('/recommend', async (req, res) => {
    try {
      const { ModelRouter } = await import('../lib/modelRouter.js');
      const router = new ModelRouter(req.app.locals.agentConfig);
      const { prompt, preferFree, provider } = req.body || {};

      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      const task = router.classifyTask(prompt);
      const recommendations = router.recommend(task, {
        preferFree: !!preferFree,
        provider: provider || null,
      });

      res.json({ task, recommendations });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/:provider', (req, res) => {
    const cfg = getProviderConfig(req.params.provider);
    if (!cfg.models || cfg.models.length === 0)
      return res.status(404).json({ error: 'Unknown provider' });
    res.json({
      provider: req.params.provider,
      models: sortModels(cfg.models),
      fallback: cfg.fallbackModel || null
    });
  });

  return router;
}
