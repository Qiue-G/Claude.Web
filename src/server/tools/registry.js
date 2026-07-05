const TOOL_DEFINITIONS = [
  {
    id: 'web_search',
    label: 'Web Search',
    description: '联网搜索获取最新信息',
    icon: 'globe',
    instruction: 'You can search the web for up-to-date information. Use web search results when the user asks about current events, recent data, news, or information that may require fresh sources.',
    configured: () => true
  },
  {
    id: 'code_interpreter',
    label: 'Code Interpreter',
    description: '执行 Python 代码并返回结果',
    icon: 'inbox',
    instruction: 'You can execute Python code for calculations and data analysis. When useful, provide executable Python code in a fenced python code block.',
    configured: () => true
  },
  {
    id: 'image_generation',
    label: 'Image Generation',
    description: '根据文本描述生成图片',
    icon: 'eye',
    instruction: 'Image generation requires a configured image generation API before it can be used.',
    configured: (env = process.env) => Boolean(env.IMAGE_GENERATION_API_KEY),
    unavailableReason: 'missing API key'
  },
  {
    id: 'file_analysis',
    label: 'File Analysis',
    description: '分析上传的文件内容',
    icon: 'file',
    instruction: 'You can analyze uploaded file contents provided in the current message context and summarize key insights.',
    configured: () => true
  },
  {
    id: 'rag_search',
    label: 'Knowledge Base',
    description: '在知识库中搜索相关文档内容',
    icon: 'database',
    instruction: 'You can search the knowledge base to find relevant documents and information. Use this when the user asks about previously uploaded documents, project files, or stored knowledge. The search results include the most relevant text chunks with similarity scores.',
    configured: (env = process.env) => Boolean(env.RAG_ENABLED) || Boolean(env.OPENAI_API_KEY),
    unavailableReason: 'RAG system not initialized'
  },
  {
    id: 'write_file',
    label: 'Write File',
    description: '直接写入文件（绕过沙箱限制）',
    icon: 'file-plus',
    instruction: 'You can write files directly to disk using Node.js fs.writeFile, bypassing shell sandbox restrictions. Use this instead of bash echo/redirect when creating or overwriting files. Output in the following format:\n\n```write_file\npath: relative/file/path\nlanguage: file_extension\n\nThe file content goes here...\n```',
    configured: () => true
  },
  {
    id: 'edit_file',
    label: 'Edit File',
    description: '编辑已存在文件的内容',
    icon: 'file-edit',
    instruction: 'You can edit existing files using search-and-replace. Use this when the user asks to modify a file. Output in the following format:\n\n```edit_file\npath: relative/file/path\n<<<<<<< SEARCH\nold content to replace\n=======\nnew content to replace with\n>>>>>>>\n```',
    configured: () => true
  }
];

const TOOL_BY_ID = new Map(TOOL_DEFINITIONS.map(tool => [tool.id, tool]));

/**
 * Get tool instructions for enabled built-in tools.
 */
export function getToolInstructions(enabledTools = []) {
  const enabled = new Set(enabledTools);
  return TOOL_DEFINITIONS
    .filter(tool => enabled.has(tool.id) && tool.instruction && tool.configured())
    .map(tool => tool.instruction)
    .join('\n');
}

/**
 * Check if a tool ID is a built-in tool.
 */
export function isBuiltinTool(toolId) {
  return TOOL_BY_ID.has(toolId);
}

/**
 * Check if a tool ID is an MCP tool (prefixed with "mcp_").
 */
export function isMcpTool(toolId) {
  return toolId.startsWith('mcp_');
}

/**
 * Parse an MCP tool ID into { serverName, toolName }.
 * Format: mcp_{serverName}_{toolName}
 */
export function parseMcpToolId(toolId) {
  // mcp_{serverName}_{toolName}
  const parts = toolId.split('_');
  if (parts.length < 3 || parts[0] !== 'mcp') return null;
  const serverName = parts[1];
  const toolName = parts.slice(2).join('_');
  return { serverName, toolName };
}

/**
 * Check if a built-in tool is configured.
 */
export function isToolConfigured(toolId, env = process.env) {
  const tool = TOOL_BY_ID.get(toolId);
  return tool ? tool.configured(env) : false;
}

/**
 * Get built-in tool definitions.
 */
export function getToolDefinitions(env = process.env) {
  return TOOL_DEFINITIONS.map(tool => {
    const configured = tool.configured(env);
    return {
      id: tool.id,
      label: tool.label,
      description: tool.description,
      icon: tool.icon,
      configured,
      unavailableReason: configured ? null : tool.unavailableReason || 'not configured',
      instruction: tool.instruction
    };
  });
}
