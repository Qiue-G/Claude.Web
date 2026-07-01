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
  // 英语基础敏感词
  'fuck', 'fucking', 'fuck you', 'fuck off', 'motherfucker',
  'shit', 'bullshit', 'horseshit',
  'ass', 'asshole', 'bastard', 'bitch', 'son of a bitch',
  'damn', 'goddamn', 'dammit',
  'crap', 'sucks',
  'dick', 'prick', 'cock', 'cocksucker',
  'pussy', 'cunt', 'whore', 'slut',
  'nigger', 'nigga',
  'retard', 'retarded',
  // 中文基础敏感词
  '他妈', '妈的', '草泥马', '操你妈', '傻逼', 'SB', '煞笔',
  '废物', '垃圾', '去死', '滚蛋', '混蛋', '王八蛋',
  '日你', '干你', '操你',
  '你妈逼', '麻痹', '妈逼',
  '狗屎', '放屁',
  '死全家', '全家死光',
  'TMD', 'NMD', 'CNM', 'WCNM',
];

/**
 * 构建敏感词匹配模式
 * 按长度降序排列，确保最长匹配优先（如 "fuck you" 先于 "fuck" 匹配）
 */
function buildPatterns(customWords = []) {
  const words = [...DEFAULT_BLOCKED_WORDS, ...customWords];
  if (words.length === 0) return null;
  // 按长度降序排列 → 最长匹配优先
  const sorted = words.sort((a, b) => b.length - a.length);
  return new RegExp(sorted.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
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