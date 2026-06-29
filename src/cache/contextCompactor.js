/**
 * 上下文压缩器（Context Compactor）
 *
 * 当对话历史超过容量限制时，不再简单截断中间消息，
 * 而是对较旧的消息进行智能压缩，保留高价值信号：
 *   - decisions（决定/决策）
 *   - constraints（约束条件）
 *   - user-provided facts（用户提供的事实）
 *   - explicit goals（明确的目标）
 *
 * 压缩后的内容以 [Compacted Context] 区块呈现。
 */

/** 高价值信号正则：匹配包含决策、约束、目标等关键词的行 */
const HIGH_SIGNAL = new RegExp(
  '(?:\\b(?:decid|chosen|select|prefer|must\\s|need\\s|require|cannot|important|goal\\s|purpose)\\b)' +
  '|(?:\\b(?:决定|选择|必须|需要|不能|重要|目标|目的是)\\b)',
  'iu'
);

/** 低价值噪声模式：单轮简短确认、格式无关的行 */
const LOW_VALUE = /^\s*(?:好的|可以|OK|ok|yes|no|对|没错|是的|[👍👎✅❌])\s*$/u;

/**
 * 压缩对话历史
 *
 * @param {Array<{ role: string, content: string }>} history - 完整历史消息
 * @param {object} [options]
 * @param {number} [options.maxRecent=8] - 保留完整的最新消息数
 * @param {number} [options.maxChars=4000] - 压缩部分最大字符数
 * @returns {Array<{ role: string, content: string }>} 压缩后的历史
 */
export function compactHistory(history, options = {}) {
  const maxRecent = options.maxRecent ?? 8;
  const maxChars = options.maxChars ?? 4000;

  if (!Array.isArray(history) || history.length <= maxRecent) {
    return history;
  }

  // 拆分：最新消息保留完整，旧消息压缩
  const recent = history.slice(-maxRecent);
  const older = history.slice(0, -maxRecent);

  // 从旧消息中提取高价值行
  const signalLines = [];
  const seen = new Set();

  for (const msg of older) {
    if (!msg.content) continue;
    const lines = msg.content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 3) continue;
      if (LOW_VALUE.test(trimmed)) continue;
      if (HIGH_SIGNAL.test(trimmed)) {
        // 去重：相同文本只保留一次
        const sig = trimmed.substring(0, 80);
        if (seen.has(sig)) continue;
        seen.add(sig);
        signalLines.push(`[${msg.role}] ${trimmed}`);
      }
    }
  }

  // 构造压缩区块
  let compacted = '';
  if (signalLines.length > 0) {
    compacted = '【压缩的上下文】以下是从早期对话中提取的关键信息（决策、约束、目标）：\n'
      + signalLines.map(l => `- ${l}`).join('\n');
    if (compacted.length > maxChars) {
      compacted = compacted.substring(0, maxChars);
    }
  } else {
    compacted = `【压缩的上下文】早期 ${older.length} 条消息未包含需保留的关键决策信息，已自动精简。`;
  }

  // 计算被压缩的消息角色分布
  const userCount = older.filter(m => m.role === 'user').length;
  const asstCount = older.filter(m => m.role === 'assistant').length;
  compacted += `\n（本次压缩：${older.length} 条消息，其中 user ${userCount} / assistant ${asstCount}）`;

  // 返回压缩后的历史
  return [
    { role: 'system', content: compacted },
    ...recent,
  ];
}

/**
 * 将压缩后的历史格式化为文本字符串（用于 buildPrompt）
 */
export function formatCompactedHistory(compactHistory) {
  return compactHistory.map(msg => {
    const prefix = msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'system';
    return `${prefix}: ${msg.content}`;
  }).join('\n');
}