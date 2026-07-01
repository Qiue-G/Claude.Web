/**
 * Filters 管道引擎
 *
 * 在消息流（input/output）中按顺序执行内置过滤器。
 * 每个 filter 实现 async function filter({ type, content, session, context })
 * 返回 { content, abort?, reason? }
 *
 * type: 'input'  | 'output'
 * abort: true 则中断管道并丢弃消息
 */

/**
 * 运行指定阶段的所有过滤器
 * @param {string} type - 'input' | 'output'
 * @param {string} content - 原始内容
 * @param {object} options
 * @param {object} [options.session]
 * @param {object} [options.context] - 额外上下文（工具结果、RAG 结果等）
 * @param {object[]} filters - 过滤器列表（按顺序执行）
 * @returns {Promise<{ content: string, aborted: boolean, reason?: string, results: object[] }>}
 */
export async function runFilters(type, content, options = {}, filters = []) {
  if (!filters || filters.length === 0) {
    return { content, aborted: false, results: [] };
  }

  let current = content;
  const results = [];

  for (const filter of filters) {
    if (!filter.enabled) continue;

    try {
      // 为每个 filter 注入其专属配置（从 options.context.filterOptions 中按 id 提取）
      const allFilterOptions = (options.context && options.context.filterOptions) || {};
      const specificOptions = allFilterOptions[filter.id] || {};

      const result = await filter.handler({
        type,
        content: current,
        session: options.session,
        context: {
          ...(options.context || {}),
          filterOptions: specificOptions
        }
      });

      results.push({
        id: filter.id,
        applied: true,
        modified: result.content !== current,
        aborted: !!result.abort,
        reason: result.reason
      });

      if (result.abort) {
        return {
          content: current,
          aborted: true,
          reason: result.reason || `Filter "${filter.id}" aborted`,
          results
        };
      }

      current = result.content;
    } catch (err) {
      console.error(`[Filter] "${filter.id}" error:`, err.message);
      results.push({ id: filter.id, applied: true, error: err.message });
      // 默认不中断管道，继续执行下一个 filter
    }
  }

  return { content: current, aborted: false, results };
}