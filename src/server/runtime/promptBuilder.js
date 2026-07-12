import { getOrBuildPrefix } from '../../cache/immutablePrefix.js';
import { compactHistory } from '../../cache/contextCompactor.js';
import { buildBackendSystemPromptPrefix } from './backendPromptLoader.js';
import { getToolSchemas } from '../tools/toolSchemas.js';

const TOOL_SECTION_TITLES = {
  file_analysis: 'File Analysis',
  code_interpreter: 'Code Interpreter',
  web_search: 'Web Search Results',
  rag_search: 'Knowledge Base Results'
};

/** 最小 fallback 提示词（仅在无后端 JSON 且无 systemPrompts.js 时使用） */
function loadFallbackPrefix() {
  return `You are an interactive agent that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.`;
}

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
  enableTools = true,
} = {}) {
  const sections = [];

  // ===== 系统提示词前缀（身份、行为、规范） =====
  // 优先使用后端 free-code 提取的提示词，不可用时回退到本地硬编码
  let systemPrefix = buildBackendSystemPromptPrefix();
  if (!systemPrefix) {
    systemPrefix = loadFallbackPrefix();
  }
  sections.push(systemPrefix);

  // ===== 工具指令 =====
  if (toolInstructions && toolInstructions.trim()) {
    const prefixText = getOrBuildPrefix(activeToolIds, () =>
      `[Tool Instructions]\nYou have the following tools available:\n${toolInstructions.trim()}`
    );
    sections.push(prefixText);
  }

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

  const systemPrompt = sections.join('\n\n');
  
  if (enableTools) {
    // 从 activeToolIds 获取 Anthropic 格式工具 schema
    const coreSchemas = getToolSchemas(activeToolIds, { core: true, approval: false });
    // 内置工具 schema（需审批的）
    const approvalSchemas = getToolSchemas(activeToolIds, { core: false, approval: true });
    const allSchemas = [...coreSchemas, ...approvalSchemas];
    return { systemPrompt, tools: allSchemas, userMessage: String(userMessage || '').trim() };
  }
  
  return { systemPrompt, tools: [], userMessage: String(userMessage || '').trim() };
}

/**
 * 格式化历史为文本，限制总字符数
 */
function formatHistory(history, maxChars) {
  const lines = [];
  let totalLen = 0;
  // 从最新向前遍历，由 maxChars 决定保留多少条（compactor 已保证总数可控）
  const recent = history.slice(-50);

  for (const msg of recent.reverse()) {
    const line = (msg.role || 'user') + ': ' + (msg.content || '');
    if (totalLen + line.length > maxChars) {
      lines.push('(conversation history truncated)');
      break;
    }
    lines.unshift(line);
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