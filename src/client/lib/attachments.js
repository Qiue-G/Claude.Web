const DEFAULT_MAX_CHARS_PER_FILE = 40_000;
const DEFAULT_MAX_TOTAL_CHARS = 120_000;

function isTextLike(file) {
  const type = file.type || '';
  const name = file.name || '';
  return (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/javascript' ||
    type === 'application/typescript' ||
    /\.(md|txt|csv|json|js|ts|tsx|jsx|html|css|xml|yaml|yml|log)$/i.test(name)
  );
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: text.slice(0, maxChars),
    truncated: true
  };
}

export async function readFilesForAI(files = [], options = {}) {
  const maxCharsPerFile = options.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE;
  const maxTotalChars = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const fileMeta = [];
  const parts = [];
  let remainingTotal = maxTotalChars;

  for (const file of files) {
    const meta = { name: file.name, size: file.size || 0, truncated: false };

    if (!isTextLike(file)) {
      fileMeta.push(meta);
      parts.push(`--- ${file.name} ---\n[不支持直接读取此类型文件: ${file.type || 'unknown'}]`);
      continue;
    }

    if (remainingTotal <= 0) {
      meta.truncated = true;
      fileMeta.push(meta);
      parts.push(`--- ${file.name} ---\n[附件总内容已达到上限，未继续读取]`);
      continue;
    }

    try {
      const raw = await file.text();
      const allowed = Math.min(maxCharsPerFile, remainingTotal);
      const result = truncateText(raw, allowed);
      meta.truncated = result.truncated || raw.length > remainingTotal;
      fileMeta.push(meta);
      remainingTotal -= result.text.length;
      const suffix = meta.truncated ? `\n[文件内容已截断，原始长度 ${raw.length} 字符]` : '';
      parts.push(`--- ${file.name} ---\n${result.text}${suffix}`);
    } catch (e) {
      fileMeta.push(meta);
      parts.push(`--- ${file.name} ---\n[无法读取文件内容: ${e.message}]`);
    }
  }

  return {
    content: parts.join('\n\n'),
    fileMeta
  };
}
