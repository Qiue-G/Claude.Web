/**
 * Pipelines 执行引擎
 *
 * 按 type（input/output）过滤并顺序执行管道。
 * 每个 pipeline 接收 { content, session, context }，返回 { content }。
 * 错误不会中断整个管道链——失败管道静默跳过。
 */

/**
 * 运行指定类型的所有管道
 * @param {string} type - 'input' | 'output'
 * @param {string} content - 当前消息内容
 * @param {object} options
 * @param {object} [options.session] - 当前会话
 * @param {object} [options.context] - 额外上下文
 * @param {Array<{ id: string, type: string, pipe: Function }>} [pipelines] - 管道列表
 * @returns {Promise<{ content: string, results: Array<{ id: string, applied: boolean, error?: string }> }>}
 */
export async function runPipelines(type, content, options = {}, pipelines = []) {
  if (!pipelines || pipelines.length === 0) {
    return { content, results: [] };
  }

  // 过滤出匹配 type 的管道
  const matching = pipelines.filter(
    p => p.type === type || p.type === 'both'
  );

  if (matching.length === 0) {
    return { content, results: [] };
  }

  let current = content;
  const results = [];

  for (const pipeline of matching) {
    try {
      const result = await pipeline.pipe({
        content: current,
        session: options.session || null,
        context: { ...(options.context || {}), _pipelinePhase: type },
      });

      const modified = result && typeof result.content === 'string' && result.content !== current;

      if (modified) {
        current = result.content;
      }

      results.push({
        id: pipeline.id,
        applied: true,
        modified,
      });

      if (modified) {
        console.log(`[PIPELINES] "${pipeline.id}" modified content (${type})`);
      }
    } catch (err) {
      console.warn(`[PIPELINES] "${pipeline.id}" error: ${err.message}`);
      results.push({
        id: pipeline.id,
        applied: true,
        error: err.message,
      });
      // 不中断管道链
    }
  }

  return { content: current, results };
}
