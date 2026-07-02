/**
 * Prompt Templates — 提示词模板管理
 *
 * 提供预设的提示词模板，用户可快速选择使用。
 * 模板支持变量插值（{code}, {text} 等）和模型推荐。
 */
const TEMPLATES = [
  {
    id: 'code-review',
    name: '代码审查',
    nameEn: 'Code Review',
    description: '审查代码的安全性、性能和可维护性',
    descriptionEn: 'Review code for security, performance and maintainability',
    prompt: '请审查以下代码，重点关注：\n1. 安全性：是否存在注入、XSS、敏感数据泄露等风险\n2. 性能：是否存在O(n²)算法、不必要的内存分配\n3. 可维护性：命名、模块化、错误处理是否合理\n4. 正确性：边界条件、并发安全\n\n对每个问题给出修改建议。\n\n```\n{code}\n```',
    variables: ['code'],
    recommendModels: ['claude-sonnet-4-20250514', 'gpt-4.1', 'deepseek/deepseek-chat-v3-0324:free'],
    category: 'code',
  },
  {
    id: 'explain-code',
    name: '代码解释',
    nameEn: 'Explain Code',
    description: '通俗易懂地解释代码的工作原理',
    descriptionEn: 'Explain how code works in simple terms',
    prompt: '请用通俗易懂的方式解释以下代码的工作原理，包括：\n1. 这段代码的输入输出是什么\n2. 核心算法/逻辑是什么\n3. 关键变量和函数的作用\n4. 如果有可以改进的地方，请指出\n\n```\n{code}\n```',
    variables: ['code'],
    recommendModels: ['deepseek-reasoner', 'claude-sonnet-4-20250514'],
    category: 'code',
  },
  {
    id: 'write-test',
    name: '编写测试',
    nameEn: 'Write Tests',
    description: '为代码生成单元测试',
    descriptionEn: 'Generate unit tests for the code',
    prompt: '请为以下代码编写完整的单元测试，使用 {framework} 测试框架。\n要求：\n1. 覆盖正常路径和边界条件\n2. 包含 Mock 外部依赖\n3. 测试命名清晰表达测试意图\n\n```\n{code}\n```\n\n请只输出测试代码。',
    variables: ['code', 'framework'],
    defaults: { framework: 'vitest' },
    recommendModels: ['claude-sonnet-4-20250514', 'gpt-4o'],
    category: 'code',
  },
  {
    id: 'debug-error',
    name: '调试错误',
    nameEn: 'Debug Error',
    description: '分析错误信息并定位问题',
    descriptionEn: 'Analyze error messages and locate the issue',
    prompt: '我有以下错误需要调试：\n\n错误信息：\n```\n{error}\n```\n\n相关代码：\n```\n{code}\n```\n\n请：\n1. 分析错误的根因\n2. 解释为什么会导致这个错误\n3. 给出修复方案的代码',
    variables: ['error', 'code'],
    recommendModels: ['deepseek-reasoner', 'claude-sonnet-4-20250514'],
    category: 'code',
  },
  {
    id: 'write-article',
    name: '撰写文章',
    nameEn: 'Write Article',
    description: '根据大纲撰写技术文章',
    descriptionEn: 'Write a technical article from an outline',
    prompt: '请根据以下大纲撰写一篇技术文章：\n\n主题：{topic}\n\n要求：\n- 语气专业且易懂\n- 包含实际代码示例\n- 文章长度：中等（约 1500 字）\n- 结构清晰，有小标题分隔\n\n额外要求：{requirements}',
    variables: ['topic', 'requirements'],
    defaults: { requirements: '无' },
    recommendModels: ['claude-sonnet-4-20250514', 'gpt-4o'],
    category: 'writing',
  },
  {
    id: 'summarize',
    name: '总结摘要',
    nameEn: 'Summarize',
    description: '为长文本生成简洁摘要',
    descriptionEn: 'Generate a concise summary of long text',
    prompt: '请为以下内容生成简洁的摘要，保留关键信息和结论：\n\n{text}\n\n摘要格式：\n- 核心观点（1-2句）\n- 关键要点（3-5个要点）\n- 结论/建议（如有）',
    variables: ['text'],
    recommendModels: ['google/gemini-2.0-flash-lite-001', 'gpt-4o-mini'],
    category: 'writing',
  },
  {
    id: 'translate',
    name: '翻译',
    nameEn: 'Translate',
    description: '将文本翻译为目标语言',
    descriptionEn: 'Translate text to the target language',
    prompt: '请将以下文本从 {sourceLang} 翻译为 {targetLang}：\n\n{text}\n\n要求：\n1. 保持原文的语气和风格\n2. 专业术语准确\n3. 通顺自然，符合目标语言习惯\n\n只输出翻译结果。',
    variables: ['text', 'sourceLang', 'targetLang'],
    defaults: { sourceLang: '英文', targetLang: '中文' },
    recommendModels: ['gpt-4o-mini', 'claude-3-5-haiku-20241022'],
    category: 'writing',
  },
  {
    id: 'arch-design',
    name: '架构设计',
    nameEn: 'Architecture Design',
    description: '设计系统架构方案',
    descriptionEn: 'Design a system architecture plan',
    prompt: '请为以下需求设计系统架构：\n\n项目描述：{description}\n\n技术要求：{requirements}\n\n请输出：\n1. 系统架构图（使用 ASCII 或 Markdown 图示）\n2. 核心模块说明\n3. 技术选型及理由\n4. 数据流设计\n5. 部署方案',
    variables: ['description', 'requirements'],
    recommendModels: ['claude-sonnet-4-20250514', 'gpt-4.1'],
    category: 'analysis',
  },
];

/**
 * 获取所有模板
 */
export function getTemplates(locale = 'zh') {
  return TEMPLATES.map(t => ({
    id: t.id,
    name: locale === 'en' ? t.nameEn : t.name,
    description: locale === 'en' ? t.descriptionEn : t.description,
    category: t.category,
    variables: t.variables,
    defaults: t.defaults || {},
    recommendModels: t.recommendModels,
  }));
}

/**
 * 根据模板 ID 获取模板详情
 */
export function getTemplateById(id) {
  return TEMPLATES.find(t => t.id === id) || null;
}

/**
 * 根据模板 ID 和变量值渲染最终提示词
 */
export function renderTemplate(templateId, variables = {}) {
  const template = getTemplateById(templateId);
  if (!template) return null;

  let prompt = template.prompt;
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
  }
  // 替换未提供的变量为空
  prompt = prompt.replace(/\{[^}]+\}/g, '');
  return prompt;
}
