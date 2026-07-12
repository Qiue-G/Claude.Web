/**
 * 工具执行模块 — 将结构化 tool_use 分派到对应执行器
 */
import { bridgeWriteFile, bridgeReadFile, bridgeEditFile, bridgeDeleteFile, bridgeRenameFile, bridgeListFiles } from '../../tools/freeCodeBridge.js';
import { executeGlob, executeGrep, executeTodoWrite } from '../../tools/freeCodeTools.js';
import { executePython } from '../../tools/codeInterpreter.js';
import { searchWeb } from '../../tools/webSearch.js';
import { parseMcpToolId } from '../../tools/registry.js';

function validateParam(val, label) {
  if (!val || (typeof val === 'string' && !val.trim())) {
    throw new Error(`tool_use: ${label} 参数缺失`);
  }
  return val.trim();
}

/**
 * 执行 tool_use 块（Function Calling 模式）
 */
export async function executeToolUseBlock(tb, session, mcpManager) {
  const { name, input } = tb;

  switch (name) {
    case 'write_file': {
      const p = validateParam(input.file_path || input.path, 'file_path');
      return await bridgeWriteFile(p, String(input.content ?? ''), session.dir);
    }
    case 'read_file':
    case 'read': {
      const p = validateParam(input.file_path || input.path, 'file_path');
      return await bridgeReadFile(p, session.dir);
    }
    case 'edit_file':
    case 'edit': {
      const p = validateParam(input.file_path || input.path, 'file_path');
      const oldStr = validateParam(input.old_string || input.searchStr, 'old_string/searchStr');
      return await bridgeEditFile(p, oldStr, input.new_string || input.replaceStr || '', session.dir);
    }
    case 'delete_file': {
      const p = validateParam(input.file_path || input.path, 'file_path');
      return await bridgeDeleteFile(p, session.dir);
    }
    case 'rename_file': {
      const oldPath = validateParam(input.file_path || input.path, 'file_path');
      const newPath = validateParam(input.new_path || input.newPath, 'new_path/newPath');
      return await bridgeRenameFile(oldPath, newPath, session.dir);
    }
    case 'list_files':
      return await bridgeListFiles(input.dir || input.path || '.', session.dir);
    case 'glob':
      return await executeGlob(input, session);
    case 'grep':
      return await executeGrep(input, session);
    case 'todo_write':
      return await executeTodoWrite(input, session);
    case 'code_interpreter': {
      const result = await executePython(input.code || '');
      let output = '';
      if (result.stdout) output += `输出:\n${result.stdout}`;
      if (result.stderr) output += `错误:\n${result.stderr}`;
      if (result.exitCode !== 0) output += `\n退出码: ${result.exitCode}`;
      return output || '空输出';
    }
    case 'web_search': {
      const results = await searchWeb(input.query);
      return JSON.stringify(results, null, 2);
    }
    default:
      if (name.startsWith('mcp_')) {
        const parsed = parseMcpToolId(name);
        if (parsed && mcpManager) {
          return JSON.stringify(await mcpManager.callTool(parsed.serverName, parsed.toolName, input));
        }
        return 'MCP 工具不可用';
      }
      throw new Error(`未知工具: ${name}`);
  }
}
