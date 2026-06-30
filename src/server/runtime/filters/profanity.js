/**
 * profanity Filter
 *
 * 类型: output
 * 内容审查过滤器。检查 AI 输出中的敏感/不当内容，
 * 可配置为替换或阻断。
 *
 * 配置项:
 *   - action: 'block' | 'replace' | 'warn' (默认 'warn')
 *     block: 完全阻断输出
 *     replace: 用 *** 替换敏感词
 *     warn: 仅添加警告标记
 *   - customWords: string[] (可选) — 自定义敏感词列表
 *   - logOnly: boolean (默认 false) — 仅记录日志，不做处理
 *
 * 内置敏感词列表为基础词库，可通过 customWords 扩展。
 */

const DEFAULT_BLOCKED_WORDS = [
  // 保留非常基础的敏感词列表，实际部署中应扩展
];

/**
 * 构建敏感词匹配模式
 */
function buildPatterns(customWords = []) {
  const words = [...DEFAULT_BLOCKED_WORDS, ...customWords];
  if (words.length === 0) return null;
  return new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
}

export const profanityFilter = {
  id: 'profanity',
  name: '内容审查',
  description: '检查 AI 输出中的敏感/不当内容',
  type: 'output',

  async handler({ type, content, session, context }) {
    if (type !== 'output') return { content };

    const options = context.filterOptions || {};
    const action = options.action || 'warn';
    const logOnly = options.logOnly === true;

    const pattern = buildPatterns(options.customWords);
    if (!pattern) return { content };

    const matches = content.match(pattern);
    if (!matches) return { content };

    if (logOnly) {
      console.warn(`[Filter:profanity] detected ${matches.length} matches (logOnly mode)`);
      return { content: `${content}\n\n[内容审查: 检测到 ${matches.length} 处敏感内容]` };
    }

    switch (action) {
      case 'block':
        console.warn(`[Filter:profanity] blocked output (${matches.length} matches)`);
        return {
          content,
          abort: true,
          reason: '输出内容包含不当表述，已被内容审查阻断'
        };

      case 'replace': {
        const replaced = content.replace(pattern, '***');
        console.warn(`[Filter:profanity] replaced ${matches.length} matches`);
        return { content: replaced };
      }

      case 'warn':
      default: {
        console.warn(`[Filter:profanity] warning: ${matches.length} matches`);
        const warning = `\n\n> ⚠️ 内容审查: 输出中包含 ${matches.length} 处敏感词汇`;
        return { content: content + warning };
      }
    }
  }
};