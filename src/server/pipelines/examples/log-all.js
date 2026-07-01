/**
 * 日志管道示例
 *
 * 记录所有通过管道的消息（input/output）到控制台。
 * 可用于调试和审计消息流。
 */
export const meta = {
  id: 'log-all',
  name: '日志记录',
  description: '记录所有 input/output 消息到控制台',
  type: 'both',
};

/**
 * @param {object} params
 * @param {string} params.content
 * @param {object} [params.session]
 * @param {object} [params.context]
 * @returns {Promise<{ content: string }>}
 */
export async function pipe({ content, session, context }) {
  if (!content) return { content };

  const sessionId = session?.id || 'unknown';
  const preview = content.substring(0, 100).replace(/\n/g, '\\n');
  const contextKeys = context ? Object.keys(context).join(', ') : 'none';

  console.log(`[PIPE:log-all] session=${sessionId} len=${content.length} preview="${preview}" context=[${contextKeys}]`);

  return { content };
}
