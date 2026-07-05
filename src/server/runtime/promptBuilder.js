import { getOrBuildPrefix } from '../../cache/immutablePrefix.js';
import { compactHistory } from '../../cache/contextCompactor.js';

const TOOL_SECTION_TITLES = {
  file_analysis: 'File Analysis',
  code_interpreter: 'Code Interpreter',
  web_search: 'Web Search Results',
  rag_search: 'Knowledge Base Results'
};

function sectionTitleForTool(tool) {
  return TOOL_SECTION_TITLES[tool] || String(tool || 'Tool Result').replace(/_/g, ' ');
}

function appendToolResultSections(sections, toolResults = []) {
  for (const result of toolResults) {
    if (!result || !result.ok || !result.content || !String(result.content).trim()) continue;
    const title = sectionTitleForTool(result.tool);
    sections.push(`[${title}]\n${String(result.content).trim()}`);
  }
}

/**
 * 构建完整的提示词
 *
 * @param {object} options
 * @param {string} [options.toolInstructions=''] - 原始工具指令文本
 * @param {string[]} [options.activeToolIds=[]] - 已激活的工具 ID 列表（用于前缀缓存）
 * @param {Array} [options.toolResults=[]] - 工具执行结果
 * @param {string} [options.userMessage=''] - 用户最新消息
 * @param {Array} [options.history=[]] - 对话历史
 * @param {boolean} [options.enableCompaction=false] - 是否启用上下文压缩
 * @param {number} [options.maxHistoryChars=8000] - 历史最大字符数
 * @returns {string}
 */
export function buildPrompt({
  toolInstructions = '',
  activeToolIds = [],
  toolResults = [],
  userMessage = '',
  history = [],
  enableCompaction = false,
  maxHistoryChars = 8000,
} = {}) {
  const sections = [];

  // ===== 系统指令（ImmutablePrefix 缓存） =====
  if (toolInstructions && toolInstructions.trim()) {
    const prefixText = getOrBuildPrefix(activeToolIds, () =>
      `[System Instructions]\nYou have the following tools available:\n${toolInstructions.trim()}`
    );
    sections.push(prefixText);
  }

  // ===== 通用规则（不被缓存，始终注入） =====
  sections.push(
    '[General Rules]\n' +
    '- When you output a bash/sh/shell code block (```bash ... ```), it automatically gets an "允许执行" (' +
    '"Allow Execute") button that users can click to run the command directly.\n' +
    '- Do NOT ask users to type "批准" or "approve" or any approval message to execute commands.\n' +
    '- Instead, tell users to click the "允许执行" button on the code block.\n' +
    '- For interactive commands that require user input (like "npm create", "npx create-"), ' +
    'prefer non-interactive flags (e.g. "npm create vite@latest my-app -- --template react" uses ' +
    'the -- flag to pass args to create-vite non-interactively).\n' +
    '- If a command is interactive, warn the user they need to use the "允许执行" button ' +
    'and the command may prompt for input.'
  );

  // ===== 工具结果 =====
  appendToolResultSections(sections, toolResults);

  // ===== 对话历史（可选压缩） =====
  if (Array.isArray(history) && history.length > 0) {
    let processedHistory = history;

    // 启用压缩且历史超过容量
    if (enableCompaction) {
      const rawLen = estimateStringLen(history);
      if (rawLen > maxHistoryChars) {
        processedHistory = compactHistory(history);
      }
    }

    const formatted = formatHistory(processedHistory, maxHistoryChars);
    if (formatted) {
      sections.push(`[Conversation History]\n${formatted}`);
    }
  }

  // ===== 用户消息 =====
  sections.push(`[User Message]\n${String(userMessage || '').trim()}`);

  return sections.join('\n\n');
}

/**
 * 格式化历史为文本，限制总字符数
 */
function formatHistory(history, maxChars) {
  const lines = [];
  let totalLen = 0;
  const recent = history.slice(-20);

  for (const msg of recent) {
    const line = (msg.role || 'user') + ': ' + (msg.content || '');
    if (totalLen + line.length > maxChars) {
      lines.push('(conversation history truncated)');
      break;
    }
    lines.push(line);
    totalLen += line.length;
  }

  return lines.join('\n');
}

/**
 * 估算历史总字符数
 */
function estimateStringLen(history) {
  let len = 0;
  for (const msg of history) {
    len += (msg.content || '').length + (msg.role || '').length + 2;
  }
  return len;
}