/**
 * Template routes — 提示词模板 API
 * GET  /api/templates          — 获取模板列表
 * GET  /api/templates/:id      — 获取模板详情
 * POST /api/templates/render   — 渲染模板为最终提示词
 */
import { Router } from 'express';
import { getTemplates, getTemplateById, renderTemplate } from '../lib/promptTemplates.js';

export function createTemplateRouter() {
  const router = Router();

  router.get('/', (req, res) => {
    const locale = req.query.locale === 'en' ? 'en' : 'zh';
    res.json({ templates: getTemplates(locale) });
  });

  router.get('/:id', (req, res) => {
    const template = getTemplateById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ template });
  });

  router.post('/render', (req, res) => {
    const { id, variables } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Template ID is required' });

    const prompt = renderTemplate(id, variables || {});
    if (!prompt) return res.status(404).json({ error: 'Template not found' });

    res.json({ id, prompt });
  });

  return router;
}
