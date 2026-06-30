/**
 * JSON / JSONL 文件加载器
 *
 * 展平 JSON 对象为 key-value 文本。
 * 支持：
 *   - 单对象 JSON (.json)
 *   - 对象数组 JSON (.json)
 *   - JSONL 格式 (.jsonl) — 每行一个 JSON 对象
 */
import fs from 'fs';

const JSON_EXT = /\.jsonl?$/i;

function flatten(obj, prefix = '') {
  let result = [];
  if (obj === null || obj === undefined) return result;

  if (Array.isArray(obj)) {
    result.push(`[Array] length: ${obj.length}`);
    obj.forEach((item, i) => {
      if (typeof item === 'object' && item !== null) {
        result.push(`[${i}]:`);
        result.push(flatten(item, `  ${prefix}`));
      } else {
        result.push(`[${i}]: ${item}`);
      }
    });
  } else if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof val === 'object' && val !== null) {
        result.push(`${fullKey}:`);
        result.push(flatten(val, `  ${prefix}`));
      } else {
        result.push(`${fullKey}: ${val}`);
      }
    }
  } else {
    result.push(`${prefix}: ${obj}`);
  }

  return result.join('\n');
}

export class JsonLoader {
  canHandle(filePath) {
    return JSON_EXT.test(filePath);
  }

  extensions() {
    return ['.json', '.jsonl'];
  }

  async load(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    const fileName = filePath.replace(/^.*[/\\]/, '');
    const isJsonl = /\.jsonl$/i.test(filePath);

    if (!raw) {
      return { content: '', metadata: { source: filePath, type: 'json', error: 'Empty file' } };
    }

    if (isJsonl) {
      // JSONL: 每行一个 JSON
      const lines = raw.split('\n').filter(Boolean);
      const parts = lines.map((line, i) => {
        try {
          const obj = JSON.parse(line);
          return `--- Entry ${i + 1} ---\n${flatten(obj)}`;
        } catch {
          return `--- Entry ${i + 1} ---\n(invalid JSON) ${line}`;
        }
      });
      return {
        content: `JSONL File: ${fileName}\nEntries: ${lines.length}\n\n${parts.join('\n\n')}`,
        metadata: { source: filePath, type: 'jsonl', entryCount: lines.length },
      };
    }

    // 标准 JSON
    try {
      const data = JSON.parse(raw);
      let entryCount = 1;
      if (Array.isArray(data)) entryCount = data.length;
      const content = `JSON File: ${fileName}\n${Array.isArray(data) ? `Array length: ${data.length}` : ''}\n\n${flatten(data)}`;
      return {
        content,
        metadata: { source: filePath, type: 'json', entryCount },
      };
    } catch (err) {
      return { content: '', metadata: { source: filePath, type: 'json', error: `JSON parse error: ${err.message}` } };
    }
  }
}