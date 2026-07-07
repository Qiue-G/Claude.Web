import { getOrBuildPrefix } from '../../cache/immutablePrefix.js';
import { compactHistory } from '../../cache/contextCompactor.js';

const TOOL_SECTION_TITLES = {
  file_analysis: 'File Analysis',
  code_interpreter: 'Code Interpreter',
  web_search: 'Web Search Results',
  rag_search: 'Knowledge Base Results'
};

const DEFAULT_TOOLS = [
  {
    name: 'write_file',
    description: 'Write or overwrite a file with the specified content. Creates parent directories if they do not exist. Use this for creating new files or completely rewriting existing files.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path from the workspace root' },
        content: { type: 'string', description: 'Full file content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Edit an existing file by searching for a specific text string and replacing it. Use for targeted edits instead of rewriting the entire file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path from the workspace root' },
        searchStr: { type: 'string', description: 'The exact text to search for (must be unique in the file)' },
        replaceStr: { type: 'string', description: 'The replacement text' }
      },
      required: ['path', 'searchStr', 'replaceStr']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file at the specified path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path from the workspace root' }
      },
      required: ['path']
    }
  },
  {
    name: 'rename_file',
    description: 'Rename or move a file from one path to another.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Current relative file path' },
        newPath: { type: 'string', description: 'New relative file path' }
      },
      required: ['path', 'newPath']
    }
  },
  {
    name: 'list_files',
    description: 'List all files in a directory recursively, showing relative paths.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to workspace root (default: root)' }
      },
      required: []
    }
  }
];

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

  // ===== 系统指令（ImmutablePrefix 缓存） =====
  if (toolInstructions && toolInstructions.trim()) {
    const prefixText = getOrBuildPrefix(activeToolIds, () =>
      `[System Instructions]\nYou have the following tools available:\n${toolInstructions.trim()}`
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

  // ===== 用户消息 =====
  sections.push(`[User Message]\n${String(userMessage || '').trim()}`);

  const prompt = sections.join('\n\n');
  
  if (enableTools) {
    return { prompt, tools: DEFAULT_TOOLS };
  }
  
  return { prompt, tools: [] };
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