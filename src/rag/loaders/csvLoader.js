/**
 * CSV 文件加载器
 *
 * 解析 CSV 文件，按行分块，表头作为上下文前缀。
 * 依赖: csv-parse
 */
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const CSV_EXT = /\.csv$/i;

export class CsvLoader {
  canHandle(filePath) {
    return CSV_EXT.test(filePath);
  }

  extensions() {
    return ['.csv'];
  }

  async load(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const records = parse(raw, {
      columns: true,     // 首行作为列名
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,         // 处理 UTF-8 BOM
    });

    if (!Array.isArray(records) || records.length === 0) {
      return { content: '', metadata: { source: filePath, type: 'csv', rowCount: 0 } };
    }

    const headers = Object.keys(records[0]);
    const lines = records.map((row, i) => {
      const cells = headers.map(h => `${h}: ${(row[h] || '').trim()}`);
      return `Row ${i + 1}: ${cells.join(' | ')}`;
    });

    // 表头作为上下文 + 每行转文本
    const content = [
      `CSV File: ${filePath.replace(/^.*[/\\]/, '')}`,
      `Columns: ${headers.join(', ')}`,
      `Rows: ${records.length}`,
      '',
      ...lines,
    ].join('\n');

    return {
      content,
      metadata: {
        source: filePath,
        type: 'csv',
        rowCount: records.length,
        columns: headers,
        headings: [filePath.replace(/^.*[/\\]/, ''), 'CSV Data'],
      },
    };
  }
}