const FILE_BLOCK_RE = /(?:^|\r?\n\r?\n)---\s+(.+?)\s+---\r?\n([\s\S]*?)(?=\r?\n\r?\n---\s+.+?\s+---\r?\n|$)/g;
const TRUNCATED_RE = /\[文件内容已截断，原始长度\s+(\d+)\s+字符\]/;
const UNSUPPORTED_RE = /\[不支持直接读取此类型文件:\s*([^\]]+)\]/;

function formatFileSection(file) {
  return [
    `File: ${file.name}`,
    `Truncated: ${file.truncated}`,
    file.unsupported ? 'Unsupported: true' : null,
    '',
    file.content
  ].filter(line => line !== null).join('\n');
}

export function stripFileBlocksFromPrompt(context = '') {
  return String(context || '').replace(FILE_BLOCK_RE, '').trim();
}

export function analyzeFilesFromPromptContext(context = '') {
  const source = String(context || '').trim();
  const files = [];

  if (!source) {
    return {
      tool: 'file_analysis',
      ok: true,
      content: '',
      files,
      metadata: { totalFiles: 0, totalChars: 0, skippedFiles: 0 }
    };
  }

  for (const match of source.matchAll(FILE_BLOCK_RE)) {
    const name = match[1].trim();
    const content = match[2].trim();
    const truncated = TRUNCATED_RE.test(content);
    const unsupported = UNSUPPORTED_RE.test(content);

    files.push({
      name,
      truncated,
      unsupported,
      textLength: content.length,
      content
    });
  }

  if (files.length === 0) {
    files.push({
      name: 'uploaded-content',
      truncated: TRUNCATED_RE.test(source),
      unsupported: UNSUPPORTED_RE.test(source),
      textLength: source.length,
      content: source
    });
  }

  const content = files.map(formatFileSection).join('\n\n');

  return {
    tool: 'file_analysis',
    ok: true,
    content,
    files: files.map(({ content, ...meta }) => meta),
    metadata: {
      totalFiles: files.length,
      totalChars: files.reduce((sum, file) => sum + file.textLength, 0),
      skippedFiles: files.filter(file => file.unsupported).length
    }
  };
}
