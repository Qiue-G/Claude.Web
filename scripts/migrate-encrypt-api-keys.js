/**
 * API Key 加密迁移脚本
 * 将数据库中现有的明文 API Key 加密存储
 *
 * 使用方法:
 *   node scripts/migrate-encrypt-api-keys.js
 *
 * 前提条件:
 *   1. 已设置 ENCRYPTION_KEY 环境变量
 *   2. 建议先备份数据库文件
 *
 * 注意:
 *   - 已加密的 Key（以 enc: 开头）会被跳过
 *   - 如果 ENCRYPTION_KEY 未设置，脚本会提示并退出
 */

import { initDb } from '../src/server/db.js';
import { encrypt, isEncrypted } from '../src/server/lib/crypto.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || join(__dirname, '../workspace');

async function migrate() {
  // 检查密钥是否已配置
  if (!process.env.ENCRYPTION_KEY) {
    console.error('[MIGRATE] 错误: 未设置 ENCRYPTION_KEY 环境变量');
    console.error('[MIGRATE] 请先生成密钥: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    console.error('[MIGRATE] 然后在 .env 或 Railway 环境变量中添加 ENCRYPTION_KEY=<生成的密钥>');
    process.exit(1);
  }

  console.log('[MIGRATE] 工作目录:', WORKSPACE_DIR);
  console.log('[MIGRATE] 初始化数据库...');
  const { db, saveDb } = await initDb(WORKSPACE_DIR);

  console.log('[MIGRATE] 查询所有 session...');
  const rows = db.exec('SELECT id, apiKey FROM sessions WHERE apiKey IS NOT NULL AND apiKey != ""');

  if (rows.length === 0 || !rows[0].values) {
    console.log('[MIGRATE] 没有找到需要迁移的 session');
    process.exit(0);
  }

  const cols = rows[0].columns;
  const sessions = rows[0].values.map(row => {
    const obj = {};
    cols.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });

  console.log(`[MIGRATE] 找到 ${sessions.length} 个 session`);

  let encrypted = 0;
  let skipped = 0;
  let failed = 0;

  const stmt = db.prepare('UPDATE sessions SET apiKey = ? WHERE id = ?');

  for (const session of sessions) {
    const { id, apiKey } = session;

    // 已加密的跳过
    if (isEncrypted(apiKey)) {
      skipped++;
      continue;
    }

    try {
      const encryptedKey = encrypt(apiKey);
      if (encryptedKey === apiKey) {
        // 加密失败（密钥未配置等），跳过
        failed++;
        console.warn(`[MIGRATE] session ${id} 加密失败，跳过`);
        continue;
      }
      stmt.run([encryptedKey, id]);
      encrypted++;
      console.log(`[MIGRATE] session ${id} 已加密`);
    } catch (e) {
      failed++;
      console.error(`[MIGRATE] session ${id} 迁移失败: ${e.message}`);
    }
  }

  stmt.free();

  // 保存数据库
  await saveDb();

  console.log('\n[MIGRATE] 迁移完成:');
  console.log(`  已加密: ${encrypted}`);
  console.log(`  已跳过: ${skipped}（已加密或无 Key）`);
  console.log(`  失败:   ${failed}`);

  process.exit(0);
}

migrate().catch(e => {
  console.error('[MIGRATE] 迁移过程出错:', e.message);
  process.exit(1);
});
