/**
 * formatGuard Filter
 *
 * 类型: output
 * 输出格式校验过滤器。确保 AI 输出符合预期格式要求。
 *
 * 配置项:
 *   - maxLength: number (默认 10000) — 最大字符数，超长直接截断
 *   - requireChinese: boolean (默认 false) — 要求输出包含中文
 *   - requireSections: string[] (可选) — 要求包含的章节标题列表
 *   - stripCodeFences: boolean (默认 false) — 是否需要确保代码块闭合
 *   - action: 'fix' | 'warn' | 'block' (默认 'fix')
 *     fix: 自动修复格式问题
 *     warn: 只加警告不修改
 *     block: 阻断不符合格式的输出
 */

export const formatGuardFilter = {
  id: 'formatGuard',
  name: '格式校验',
  description: '确保 AI 输出符合预期的格式要求',
  type: 'output',

  async handler({ type, content, session, context }) {
    if (type !== 'output') return { content };

    const options = context.filterOptions || {};
    const action = options.action || 'fix';
    const issues = [];

    // 1. 最大长度检查
    const maxLength = options.maxLength || 10000;
    if (content.length > maxLength && action !== 'block') {
      issues.push(`输出超长 (${content.length} > ${maxLength}), 已截断`);
      content = content.substring(0, maxLength) + '\n\n[输出已截断]';
    } else if (content.length > maxLength && action === 'block') {
      return {
        content,
        abort: true,
        reason: `输出超长 (${content.length} > ${maxLength})，已被格式校验阻断`
      };
    }

    // 2. 中文要求
    if (options.requireChinese) {
      const hasChinese = /[\u4e00-\u9fff]/.test(content);
      if (!hasChinese) {
        issues.push('输出不包含中文');
        if (action === 'block') {
          return {
            content,
            abort: true,
            reason: '输出不包含中文，已被格式校验阻断'
          };
        }
      }
    }

    // 3. 章节标题检查
    if (options.requireSections && options.requireSections.length > 0) {
      for (const section of options.requireSections) {
        if (!content.includes(section)) {
          issues.push(`缺少章节: "${section}"`);
        }
      }
    }

    // 4. 代码块闭合检查
    if (options.stripCodeFences !== false) {
      const openFences = (content.match(/```/g) || []).length;
      if (openFences % 2 !== 0) {
        issues.push('代码块未闭合');
        if (action === 'fix') {
          content += '\n```';
        } else if (action === 'block') {
          return {
            content,
            abort: true,
            reason: '代码块未闭合，已被格式校验阻断'
          };
        }
      }
    }

    // 5. 连续空行压缩
    content = content.replace(/\n{4,}/g, '\n\n\n');

    if (issues.length > 0 && action !== 'fix') {
      content += `\n\n> ⚠️ 格式校验: ${issues.join('; ')}`;
    }

    if (issues.length > 0) {
      console.log(`[Filter:formatGuard] issues: ${issues.join(', ')}`);
    }

    return { content };
  }
};