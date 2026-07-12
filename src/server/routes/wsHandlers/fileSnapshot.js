/**
 * 文件快照模块 — 会话工作目录快照 + 变更检测
 */
import fs from 'fs/promises';
import path from 'path';

const MAX_FILE_SIZE = 5 * 1024 * 1024;  // 跳过大于 5MB 的文件（防止 OOM）
const MAX_SNAPSHOT_FILES = 5000;      // 最多快照 5000 个文件

/**
 * 对目录中所有文件做哈希快照
 * Returns: Map<filePath, { hash: string, content: string, size: number }>
 */
export async function takeFileSnapshot(dirPath) {
  const snapshot = new Map();
  let fileCount = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (fileCount >= MAX_SNAPSHOT_FILES) break;
      if (entry.name === 'node_modules') continue;
      if (entry.isDirectory() && entry.name.startsWith('.')) continue;
      if (entry.name === '.env') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const subSnapshot = await takeFileSnapshot(fullPath);
        for (const [k, v] of subSnapshot) {
          if (fileCount >= MAX_SNAPSHOT_FILES) break;
          snapshot.set(path.relative(dirPath, path.join(dirPath, entry.name, k)), v);
          fileCount++;
        }
      } else if (entry.isFile()) {
        fileCount++;
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > MAX_FILE_SIZE) continue;
          const content = await fs.readFile(fullPath, 'utf-8');
          if (content.includes('\0')) continue;
          const crypto = await import('crypto');
          const hash = crypto.createHash('sha256').update(content).digest('hex');
          snapshot.set(path.relative(dirPath, fullPath), { hash, content, size: stat.size });
        } catch {} // skip binary/unreadable files
      }
    }
  } catch (e) {
    console.warn('[FILE SNAPSHOT] Error reading directory:', e.message);
  }
  return snapshot;
}

/**
 * 检测文件变更并创建版本记录
 * Returns: Array of { filePath, changes, fromVersion, toVersion, summary }
 */
export async function detectChangedFiles(session, preExecSnapshot, db) {
  const results = [];
  const currentSnapshot = await takeFileSnapshot(session.dir);

  for (const [filePath, preData] of preExecSnapshot) {
    const currentData = currentSnapshot.get(filePath);
    if (!currentData) continue;

    if (preData.hash !== currentData.hash) {
      const oldContent = preData.content;
      const newContent = currentData.content;

      let oldVersionId = null;
      try {
        const { randomUUID, createHash } = await import('crypto');
        const oldHash = createHash('sha256').update(oldContent).digest('hex');
        const oldId = randomUUID();
        db.run(
          `INSERT INTO file_versions (id, sessionId, filePath, content, hash, size, createdAt, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [oldId, session.id, filePath, oldContent, oldHash, Buffer.byteLength(oldContent, 'utf-8'), Date.now(), 'pre-exec']
        );
        oldVersionId = oldId;

        const newHash = createHash('sha256').update(newContent).digest('hex');
        const newId = randomUUID();
        db.run(
          `INSERT INTO file_versions (id, sessionId, filePath, content, hash, size, createdAt, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId, session.id, filePath, newContent, newHash, Buffer.byteLength(newContent, 'utf-8'), Date.now(), 'post-exec']
        );

        const { diffLines } = await import('diff');
        const changes = diffLines(oldContent, newContent);
        const added = changes.filter(c => c.added).reduce((s, c) => s + (c.count || 0), 0);
        const removed = changes.filter(c => c.removed).reduce((s, c) => s + (c.count || 0), 0);

        let newLineNum = 1, oldLineNum = 1;
        const changesWithLines = changes.map(c => {
          const chunk = { count: c.count, added: c.added || false, removed: c.removed || false, value: c.value, startLine: newLineNum };
          if (c.removed) { chunk.oldStartLine = oldLineNum; oldLineNum += c.count; }
          else if (c.added) { newLineNum += c.count; }
          else { newLineNum += c.count; oldLineNum += c.count; }
          return chunk;
        });

        results.push({ filePath, changes: changesWithLines, fromVersion: oldId, toVersion: newId, summary: `+${added} -${removed} in ${filePath}` });
      } catch (e) { console.error('[FILE DIFF] Error creating version:', e.message); }
    }
  }

  for (const [filePath, curData] of currentSnapshot) {
    if (preExecSnapshot.has(filePath)) continue;
    try {
      const { randomUUID, createHash } = await import('crypto');
      const newHash = createHash('sha256').update(curData.content).digest('hex');
      const newId = randomUUID();
      db.run(
        `INSERT INTO file_versions (id, sessionId, filePath, content, hash, size, createdAt, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId, session.id, filePath, curData.content, newHash, Buffer.byteLength(curData.content, 'utf-8'), Date.now(), 'post-exec']
      );
      const lines = curData.content.split('\n');
      results.push({ filePath, changes: [{ count: lines.length, added: true, value: curData.content, startLine: 1 }], fromVersion: null, toVersion: newId, summary: `+${lines.filter(l=>l.trim()).length} lines (new file) in ${filePath}` });
    } catch (e) { console.error('[FILE DIFF] Error creating version for new file:', e.message); }
  }
  return results;
}
