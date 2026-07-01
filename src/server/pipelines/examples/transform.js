/**
 * 内容变换管道示例
 *
 * 在 input 阶段对用户消息进行规范化处理：
 * - 将连续多个换行压缩为单个
 * - 移除首尾空白
 *
 * 在 output 阶段对 AI 输出添加后缀声明。
 */
export const meta = {
  id: 'transform-demo',
  name: '内容变换示例',
  description: '演示管道能力：input 压缩空白，output 添加声明',
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

  // 检测当前阶段：通过 context 中的 _type 推断（由 engine 注入）
  const phase = context?._pipelinePhase || 'input';

  if (phase === 'input') {
    // Input: 压缩多余空白和换行
    const normalized = content
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+$/gm, '')
      .trim();

    if (normalized !== content) {
      console.log(`[PIPE:transform-demo] input normalized: ${content.length} → ${normalized.length} chars`);
    }

    return { content: normalized };
  }

  if (phase === 'output') {
    // Output: 添加简短声明
    const suffix = '\n\n---\n*内容已通过 transform-demo 管道处理*';
    if (!content.endsWith(suffix)) {
      return { content: content + suffix };
    }
  }

  return { content };
}
