/**
 * 工具 JSON Schema 定义（Anthropic Tool Use 格式）
 *
 * 每个工具包含：
 *   - name:       工具名称（AI 调用时使用）
 *   - description: 工具描述（AI 理解工具用途）
 *   - input_schema: 参数 JSON Schema
 *
 * 同时保留 instruction 字段用于纯文本降级（代码围栏模式）。
 *
 * ===== 加载策略 =====
 * 1. 优先加载 Docker 构建时从 free-code 提取的后端 Schema
 * 2. 未找到后端 Schema 时使用本地硬编码回退
 */

import { loadBackendTools } from '../runtime/backendToolLoader.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

// 本地开发时 fallback 路径
const BACKEND_FALLBACK_PATH = resolve(import.meta.dirname, '../../../tools-backend.dev.json');

// ===== 后端工具名 → 本地工具名映射 =====
// 后端 JSON 中的工具名可能和本地不同，需要映射
const BACKEND_TO_LOCAL_NAME = {
  // 后端名称 → 本地名称
  'write_file': 'write_file',
  'read': 'read_file',
  'edit': 'edit_file',
  'glob': 'glob',
  'grep': 'grep',
  'todo_write': 'todo_write',
  'web_fetch': 'web_fetch',
  'web_search': 'web_search',
  'bash': 'bash',
  'skill': 'skill',
  'agent': 'agent',
  // 后端没有的工具（本地独有）
  'delete_file': null,
  'rename_file': null,
  'list_files': null,
};

// ===== 尝试加载后端 Schema =====
const _backendData = loadBackendTools();
const _backendTools = _backendData?.tools || [];
const _backendByName = new Map(_backendTools.map(t => [t.name, t]));
const _isBackendAvailable = _backendTools.length > 0;

if (_isBackendAvailable) {
  console.log(`[toolSchemas] Using backend tool definitions (${_backendTools.length} tools)`);
}

/**
 * 从后端获取工具定义，或返回 null
 */
function resolveBackend(localName) {
  // 直接查找后端同名
  const sameName = _backendByName.get(localName);
  if (sameName) return sameName;
  // 反向查找：本地名 → 后端名
  for (const [backendName, localMapped] of Object.entries(BACKEND_TO_LOCAL_NAME)) {
    if (localMapped === localName) {
      return _backendByName.get(backendName) || null;
    }
  }
  return null;
}

// ===== 文件工具 (fileTools) — 本地指令必保留，schema 优先后端 =====

function makeTool(localName, localDef) {
  const backend = resolveBackend(localName);
  if (backend) {
    return {
      name: localName,
      description: backend.description || localDef.description,
      input_schema: backend.input_schema || localDef.input_schema,
      instruction: backend.prompt || localDef.instruction,
    };
  }
  return localDef;
}

const WRITE_FILE = makeTool('write_file', {
  name: 'write_file',
  description: 'Write content to a file at the specified path. Creates the file if it does not exist, overwrites if it does.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative file path from the workspace root' },
      language: { type: 'string', description: 'File extension or language identifier for syntax highlighting' },
      content: { type: 'string', description: 'The full file content to write' }
    },
    required: ['path', 'content']
  },
  instruction: [
    'You can write files directly to disk using the following format:',
    '',
    '```write_file',
    'path: relative/file/path',
    'language: file_extension',
    '```',
    'Write the file content here. The file will be automatically created or overwritten.',
    '```',
    '',
    'Note: The path is relative to the workspace root. Back up any important data as file writes are irreversible.'
  ].join('\n')
});

const EDIT_FILE = makeTool('edit_file', {
  name: 'edit_file',
  description: 'Edit an existing file by replacing specific text content. Uses search-and-replace to make targeted changes.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative file path from the workspace root' },
      search: { type: 'string', description: 'The exact text to search for (must be unique in the file)' },
      replace: { type: 'string', description: 'The replacement text' }
    },
    required: ['path', 'search', 'replace']
  },
  instruction: [
    'You can edit existing files using search-and-replace:',
    '',
    '```edit_file',
    'path: relative/file/path',
    '<<<<<<< SEARCH',
    'existing code to replace',
    '=======',
    'new code to insert',
    '>>>>>>> REPLACE',
    '```',
    '',
    'SEARCH must match exactly, including whitespace.'
  ].join('\n')
});

const DELETE_FILE = makeTool('delete_file', {
  name: 'delete_file',
  description: 'Delete a file at the specified path. Irreversible operation.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative file path from the workspace root' }
    },
    required: ['path']
  },
  instruction: [
    'You can delete files using:',
    '',
    '```delete_file',
    'path: relative/file/path',
    '```',
    '',
    'This is irreversible. Use with caution.'
  ].join('\n')
});

const RENAME_FILE = makeTool('rename_file', {
  name: 'rename_file',
  description: 'Rename or move a file from oldPath to newPath.',
  input_schema: {
    type: 'object',
    properties: {
      oldPath: { type: 'string', description: 'Current relative file path' },
      newPath: { type: 'string', description: 'New relative file path' }
    },
    required: ['oldPath', 'newPath']
  },
  instruction: [
    'You can rename/move files using:',
    '',
    '```rename_file',
    'path: relative/file/old-name.ext',
    'newPath: relative/file/new-name.ext',
    '```'
  ].join('\n')
});

const LIST_FILES = makeTool('list_files', {
  name: 'list_files',
  description: 'List files and directories at the specified path. Shows directory structure.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative directory path (defaults to workspace root)' }
    },
    required: []
  },
  instruction: [
    'You can list files using:',
    '',
    '```list_files',
    'path: relative/directory/path',
    '```',
    '',
    'If path is omitted, lists the workspace root.'
  ].join('\n')
});

const READ_FILE = makeTool('read_file', {
  name: 'read_file',
  description: 'Read the content of a file at the specified path. Shows the full file content.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative file path from the workspace root' }
    },
    required: ['path']
  },
  instruction: [
    'You can read file contents using:',
    '',
    '```read_file',
    'path: relative/file/path',
    '```'
  ].join('\n')
});

// ===== Free-code 搜索/任务工具 =====

const GLOB = makeTool('glob', {
  name: 'glob',
  description: 'Search for files using glob patterns (e.g. **/*.js). Results are sorted by modification time.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to match files (e.g. **/*.ts, src/**/*.js)' },
      path: { type: 'string', description: 'Directory to search in (relative to workspace root, defaults to root)' }
    },
    required: ['pattern']
  },
  instruction: [
    'You can search for files using glob patterns:',
    '',
    '```glob',
    'pattern: **/*.js',
    'path: src',
    '```'
  ].join('\n')
});

const GREP = makeTool('grep', {
  name: 'grep',
  description: 'Search file contents using regular expressions. Returns matching files or lines.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression pattern to search for in file contents' },
      path: { type: 'string', description: 'Directory to search in (relative to workspace root)' },
      glob: { type: 'string', description: 'File filter glob (e.g. *.js, **/*.ts) to narrow search scope' },
      output: { type: 'string', enum: ['files_with_matches', 'content'], description: 'Output mode: "files_with_matches" for file list, "content" for matching lines' }
    },
    required: ['pattern']
  },
  instruction: [
    'You can search file contents using regular expressions:',
    '',
    '```grep',
    'pattern: search pattern',
    'path: src',
    'glob: *.js',
    'output: files_with_matches',
    '```'
  ].join('\n')
});

const TODO_WRITE = makeTool('todo_write', {
  name: 'todo_write',
  description: 'Create or update a structured task list to track progress on complex, multi-step tasks.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Task description or action item to track' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Task status' },
      priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Task priority' }
    },
    required: ['action']
  },
  instruction: [
    'You can create and manage task lists:',
    '',
    '```todo_write',
    'action: description of the task',
    'status: pending',
    'priority: high',
    '```'
  ].join('\n')
});

// ===== 内置工具 (registry.js 工具，无后端 source) =====

const WEB_SEARCH = makeTool('web_search', {
  name: 'web_search',
  description: 'Search the web for up-to-date information about any topic. Returns search results with links.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query string' }
    },
    required: ['query']
  },
  instruction: 'You can search the web for up-to-date information. Use web search results when the user asks about current events, recent data, news, or information that may require fresh sources.'
});

const FILE_ANALYSIS = {
  name: 'file_analysis',
  description: 'Analyze the contents of an uploaded file. Returns key insights and structured information.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the uploaded file' }
    },
    required: ['path']
  },
  instruction: 'You can analyze uploaded file contents provided in the current message context and summarize key insights.'
};

const CODE_INTERPRETER = {
  name: 'code_interpreter',
  description: 'Execute Python code in a sandboxed environment. Supports pip package installation. Timeout after 35 seconds.',
  input_schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Python code to execute' }
    },
    required: ['code']
  },
  instruction: 'You can execute Python code in a sandboxed environment. Use this for calculations, data processing, or running algorithms.'
};

const IMAGE_GENERATION = {
  name: 'image_generation',
  description: 'Generate an image from a text description. Requires a configured image generation API key.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Text description of the image to generate' },
      size: { type: 'string', enum: ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9'], description: 'Image aspect ratio' }
    },
    required: ['prompt']
  },
  instruction: 'Image generation requires a configured image generation API before it can be used.'
};

const RAG_SEARCH = {
  name: 'rag_search',
  description: 'Search the knowledge base for relevant documents and information. Returns text chunks with similarity scores.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query for the knowledge base' },
      topK: { type: 'number', description: 'Number of top results to return' }
    },
    required: ['query']
  },
  instruction: 'You can search the knowledge base to find relevant documents and information.'
};

// ===== 集合 =====

/** 所有工具的完整 Schema */
const ALL_TOOL_SCHEMAS = [
  WRITE_FILE, EDIT_FILE, DELETE_FILE, RENAME_FILE, LIST_FILES, READ_FILE,
  GLOB, GREP, TODO_WRITE,
  WEB_SEARCH, FILE_ANALYSIS, CODE_INTERPRETER, IMAGE_GENERATION, RAG_SEARCH
];

/** 按 name 索引 */
const SCHEMA_BY_NAME = new Map(ALL_TOOL_SCHEMAS.map(s => [s.name, s]));

/** 仅核心文件/搜索工具（总是启用） */
const CORE_TOOL_NAMES = new Set([
  'write_file', 'edit_file', 'delete_file', 'rename_file', 'list_files', 'read_file',
  'glob', 'grep', 'todo_write',
  'code_interpreter'
]);

/** 需审批的工具 */
const APPROVAL_TOOL_NAMES = new Set([
  'web_search', 'file_analysis', 'code_interpreter', 'image_generation', 'rag_search'
]);

/**
 * 根据启用的工具 ID 列表获取 Anthropic Tool Schema 数组
 * @param {string[]} enabledToolIds
 * @param {{ core?: boolean, approval?: boolean }} [options]
 * @returns {Array<{name: string, description: string, input_schema: object}>}
 */
export function getToolSchemas(enabledToolIds = [], options = {}) {
  const enableCore = options.core !== false;
  const enableApproval = options.approval !== true;

  const names = new Set(enabledToolIds);
  if (enableCore) {
    for (const n of CORE_TOOL_NAMES) names.add(n);
  }

  const schemas = [];
  for (const name of names) {
    const schema = SCHEMA_BY_NAME.get(name);
    if (schema) {
      schemas.push({
        name: schema.name,
        description: schema.description,
        input_schema: schema.input_schema
      });
    }
  }
  return schemas;
}

/**
 * 根据启用的工具 ID 列表获取纯文本工具指令（用于降级模式）
 */
export function getToolInstructions(enabledToolIds = [], options = {}) {
  const enableCore = options.core !== false;
  const enableApproval = options.approval !== true;

  const names = new Set(enabledToolIds);
  if (enableCore) {
    for (const n of CORE_TOOL_NAMES) names.add(n);
  }

  return ALL_TOOL_SCHEMAS
    .filter(s => names.has(s.name))
    .map(s => s.instruction)
    .join('\n\n');
}

/**
 * 检查工具是否是核心工具（文件操作/搜索）
 */
export function isCoreTool(name) {
  return CORE_TOOL_NAMES.has(name);
}

/**
 * 检查工具是否需要审批
 */
export function isApprovalTool(name) {
  return APPROVAL_TOOL_NAMES.has(name);
}

/**
 * 通过 name 获取单个工具的 schema
 */
export function getToolSchema(name) {
  return SCHEMA_BY_NAME.get(name) || null;
}

/**
 * 后端工具是否可用
 */
export function isBackendAvailable() {
  return _isBackendAvailable;
}
