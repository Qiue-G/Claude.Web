/**
 * 代码文件加载器
 *
 * 按函数/类/方法定义分割代码文件，保留文件头注释。
 * 支持常见编程语言扩展名。
 *
 * 分割策略：
 *   - 使用正则匹配函数/类定义行作为分块边界
 *   - 保留文件头部注释（如 LICENSE header）作为全局上下文
 *   - 不支持语法树解析，保持轻量
 */

const CODE_EXTENSIONS = /\.(js|jsx|ts|tsx|py|rb|go|java|rs|c|cpp|h|hpp|cs|swift|kt|scala|php|pl|sh|bash|zsh|ps1|lua|r|m|mm)$/i;

// 常见语言的函数/类定义正则（按行匹配）
const DEFINITION_PATTERNS = [
  // JavaScript/TypeScript
  /^\s*(export\s+)?(function\s+\w+|class\s+\w+|const\s+\w+\s*=\s*(\([^)]*\)|\w+\s*=>|async\s*\(|async\s+\w+)|(async\s+)?(get|set)\s+\w+)/,
  // Python
  /^\s*(def\s+\w+|class\s+\w+|async\s+def\s+\w+)/,
  // Ruby
  /^\s*(def\s+\w+|class\s+\w+|module\s+\w+)/,
  // Go
  /^\s*(func\s+\w+|type\s+\w+\s+struct)/,
  // Java/C#/C++
  /^\s*(public|private|protected|internal)?\s*(static|virtual|override|abstract)?\s*(class\s+\w+|interface\s+\w+|struct\s+\w+|enum\s+\w+|function\s+\w+)/,
  // Rust
  /^\s*(fn\s+\w+|struct\s+\w+|enum\s+\w+|impl\s+\w+|trait\s+\w+|pub\s+(fn|struct|enum|impl|trait|mod)\s+\w+)/,
  // Kotlin/Swift
  /^\s*(fun\s+\w+|class\s+\w+|struct\s+\w+|enum\s+\w+|protocol\s+\w+|extension\s+\w+)/,
  // PHP
  /^\s*(function\s+\w+|class\s+\w+|interface\s+\w+)/,
  // Shell
  /^\s*(function\s+\w+|\w+\(\s*\)\s*\{)/,
];

function isDefinitionLine(line) {
  return DEFINITION_PATTERNS.some(p => p.test(line));
}

/**
 * 提取文件头注释（文件开头连续的注释块）
 */
function extractHeaderComment(lines) {
  const headerLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('<!--')) {
      headerLines.push(line);
    } else if (trimmed === '') {
      if (headerLines.length > 0) headerLines.push(line); // 允许空行分隔
      else break;
    } else {
      break;
    }
  }
  return headerLines;
}

export class CodeLoader {
  canHandle(filePath) {
    return CODE_EXTENSIONS.test(filePath);
  }

  extensions() {
    return ['.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.java', '.rs', '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.php', '.sh', '.bash', '.lua', '.r'];
  }

  async load(filePath) {
    const fs = await import('fs');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const allLines = raw.split('\n');
    const fileName = filePath.replace(/^.*[/\\]/, '');

    // 提取文件头
    const headerLines = extractHeaderComment(allLines);
    const headerText = headerLines.join('\n');

    // 按函数/类定义分割
    const sections = [];
    let currentSection = [];
    let currentDef = '';
    let inHeader = headerLines.length > 0;

    for (let i = inHeader ? headerLines.length : 0; i < allLines.length; i++) {
      const line = allLines[i];
      if (isDefinitionLine(line)) {
        if (currentSection.length > 0) {
          sections.push({ definition: currentDef, code: currentSection.join('\n') });
        }
        currentDef = line.trim();
        currentSection = [line];
      } else {
        currentSection.push(line);
      }
    }
    if (currentSection.length > 0) {
      sections.push({ definition: currentDef, code: currentSection.join('\n') });
    }

    // 格式化输出
    const parts = [];
    if (headerText) {
      parts.push(`[File Header]\n${headerText}\n`);
    }

    if (sections.length === 0) {
      // 没有可识别的定义，直接输出全部
      parts.push(raw);
    } else {
      const totalDefs = sections.length;
      parts.push(`File: ${fileName}  |  Definitions: ${totalDefs}`);
      if (totalDefs > 1) {
        parts.push(`Definitions: ${sections.map(s => s.definition || '(top-level)').join(', ')}`);
      }
      parts.push('');
      sections.forEach((s, i) => {
        if (s.definition) {
          parts.push(`--- ${s.definition} ---`);
        } else {
          parts.push(`--- Section ${i + 1} ---`);
        }
        parts.push(s.code);
        parts.push('');
      });
    }

    return {
      content: parts.join('\n'),
      metadata: {
        source: filePath,
        type: 'code',
        language: fileName.split('.').pop(),
        definitionCount: sections.length,
        headings: [fileName, ...sections.map(s => s.definition).filter(Boolean)],
      },
    };
  }
}