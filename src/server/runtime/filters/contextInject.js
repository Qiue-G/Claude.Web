/**
 * contextInject Filter
 *
 * 类型: input
 * 自动将 RAG 检索结果注入到用户消息上下文中（如果 RAG 已启用）。
 * 当用户发送消息时，自动搜索知识库并将相关文档作为上下文拼接到 prompt 中，
 * 无需客户端显式触发 rag_search 工具。
 *
 * 配置项:
 *   - topK: number (默认 3) — 检索文档数
 *   - bm25Weight: number (默认 0.3) — BM25 权重
 *   - enableRerank: boolean (默认 false) — 是否启用余弦重排
 *   - enableCrossEncoder: boolean (默认 false) — 是否启用 Cross-Encoder Rerank（优先于 enableRerank）
 *   - enableEnrichment: boolean (默认 true) — 是否启用内容富化（文件名/章节标题注入）
 *   - enableRewrite: boolean (默认 false) — 是否启用 Query 重写（需配置 rewriteConfig）
 *   - rewriteConfig: object — Query 重写配置（{ enabled, url, apiKey, model }）
 *   - rerankConfig: object — Cross-Encoder Rerank 配置（{ url, apiKey, model }）
 *   - minScore: number (默认 0.0) — 最低分数阈值
 *   - autoInject: boolean (默认 true) — 是否自动注入（设为 false 可关闭自动注入，
 *     但仍保留手动触发能力）
 *   - maxContextLength: number (默认 2000) — 注入上下文的 max 字符数
 *   - ignoreToolMessages: boolean (默认 true) — 跳过纯工具/系统指令消息
 */

export const contextInjectFilter = {
  id: 'contextInject',
  name: '上下文注入',
  description: '自动检索知识库并将相关文档注入到提示词上下文',
  type: 'input',

  async handler({ type, content, session, context }) {
    if (type !== 'input') return { content };

    const rag = context.rag;
    const options = context.filterOptions || {};

    // 如果没有 RAG 系统或禁用，跳过
    if (!rag || options.autoInject === false) {
      return { content };
    }

    // 忽略空消息或过短的消息（除非配置了 minQueryLength）
    const trimmed = (content || '').trim();
    const minQueryLength = options.minQueryLength || 10;
    if (trimmed.length < minQueryLength) {
      return { content };
    }

    // 如果配置了 ignoreToolMessages，跳过工具/命令类消息
    if (options.ignoreToolMessages !== false) {
      const toolPatterns = ['/tool', '/mcp', '/rag', '/search', '/help'];
      if (toolPatterns.some((p) => trimmed.startsWith(p))) {
        return { content };
      }
    }

    // 获取集合 — 优先使用 session 级集合，否则用 session.id
    const sessionId = session?.id;
    if (!sessionId) return { content };

    try {
      const topK = options.topK || 3;
      const bm25Weight = options.bm25Weight ?? 0.3;
      const enableRerank = options.enableRerank ?? false;
      const enableCrossEncoder = options.enableCrossEncoder ?? false;
      const enableEnrichment = options.enableEnrichment ?? true;
      const minScore = options.minScore ?? 0.0;
      const maxContextLength = options.maxContextLength || 2000;

      // 构造 rewriteConfig: 如果启用了全局 enableRewrite，注入 filter 级别的配置
      const enableRewrite = options.enableRewrite ?? false;
      let rewriteConfig = options.rewriteConfig;
      if (enableRewrite && !rewriteConfig?.enabled) {
        rewriteConfig = { ...rewriteConfig, enabled: true };
      }

      const results = await rag.search(sessionId, trimmed, {
        topK,
        bm25Weight,
        enableRerank,
        enableCrossEncoder,
        enableEnrichment,
        rewriteConfig: rewriteConfig?.enabled ? rewriteConfig : undefined,
        rerankConfig: options.rerankConfig,
      });

      if (!results || results.length === 0) {
        return { content };
      }

      const filtered = results.filter((r) => r.score >= minScore);
      if (filtered.length === 0) return { content };

      // 构建上下文块, 限制总长度
      let contextStr = '';
      for (const r of filtered) {
        const snippet = (r.text || '').trim();
        if (!snippet) continue;
        const prefix = `[知识库] (相关度: ${(r.score || 0).toFixed(4)})`;
        const entry = `\n${prefix}\n${snippet}\n`;
        if ((contextStr + entry).length > maxContextLength) break;
        contextStr += entry;
      }

      if (!contextStr) return { content };

      const injected = `<context>\n以下是与用户问题相关的知识库内容:\n${contextStr}\n</context>\n\n${content}`;

      console.log(
        `[Filter:contextInject] injected ${filtered.length} docs (${contextStr.length} chars) into prompt`
      );

      return { content: injected };
    } catch (err) {
      console.error('[Filter:contextInject] search error:', err.message);
      // 搜索失败不阻止消息
      return { content };
    }
  }
};