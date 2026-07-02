/**
 * PGVector 适配器 — 为 PostgreSQL + pgvector 扩展提供向量存储支持。
 *
 * 适配器接口：
 * - insert, searchBm25, searchVector, deleteCollection, listCollections, count
 *
 * 前置条件：
 * - PostgreSQL 16+ 安装 pgvector 扩展 (CREATE EXTENSION vector;)
 * - 连接字符串通过环境变量 PG_CONNECTION_STRING 或构造参数传入
 * - 表自动创建（每集合一张表）
 */
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;

class PgVectorAdapter {
  /**
   * @param {object} options
   * @param {string} [options.connectionString] - PostgreSQL 连接字符串
   * @param {number} [options.dimensions=256] - 向量维度
   */
  constructor(options = {}) {
    this.dimensions = options.dimensions ?? 256;
    this.connectionString = options.connectionString || process.env.PG_CONNECTION_STRING;

    if (!this.connectionString) {
      throw new Error('PgVectorAdapter requires connectionString or PG_CONNECTION_STRING env');
    }

    this.pool = new Pool({
      connectionString: this.connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  /** 获取或创建集合对应的表 */
  async #ensureTable(collection) {
    const tableName = this.#tableName(collection);
    const safeName = `"${tableName}"`;

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${safeName} (
        id SERIAL PRIMARY KEY,
        hash TEXT UNIQUE NOT NULL,
        text TEXT NOT NULL,
        embedding vector(${this.dimensions}),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${tableName}_embedding
      ON ${safeName} USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `).catch(() => {});

    return tableName;
  }

  /** 安全表名 */
  #tableName(collection) {
    const safe = collection.replace(/[^a-zA-Z0-9_]/g, '_');
    return `rag_${safe}`;
  }

  /** 计算内容哈希 */
  #hash(text) {
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  }

  async insert(collection, chunks, embeddings) {
    if (!chunks || chunks.length === 0) return;
    const tableName = await this.#ensureTable(collection);
    const safeName = `"${tableName}"`;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const hash = chunk.hash || this.#hash(chunk.text);
        const embedding = embeddings?.[i];

        if (embedding) {
          const vectorStr = `[${embedding.join(',')}]`;
          await client.query(
            `INSERT INTO ${safeName} (hash, text, embedding, metadata)
             VALUES ($1, $2, $3::vector, $4::jsonb)
             ON CONFLICT (hash) DO UPDATE SET text = EXCLUDED.text`,
            [hash, chunk.text, vectorStr, JSON.stringify(chunk.metadata || {})]
          );
        } else {
          await client.query(
            `INSERT INTO ${safeName} (hash, text, metadata)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (hash) DO UPDATE SET text = EXCLUDED.text`,
            [hash, chunk.text, JSON.stringify(chunk.metadata || {})]
          );
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async searchBm25(collection, query, limit = 10) {
    const tableName = await this.#ensureTable(collection);
    const safeName = `"${tableName}"`;

    const tsQuery = query
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w + ':*')
      .join(' & ');

    if (!tsQuery) return [];

    try {
      const result = await this.pool.query(
        `SELECT text, metadata::text as meta
         FROM ${safeName}
         WHERE to_tsvector('simple', text) @@ to_tsquery('simple', $1)
         ORDER BY ts_rank(to_tsvector('simple', text), to_tsquery('simple', $1)) DESC
         LIMIT $2`,
        [tsQuery, limit]
      );

      return result.rows.map((row, i) => ({
        text: row.text,
        metadata: row.meta ? JSON.parse(row.meta) : {},
        score: 1 - (i / (result.rows.length || 1)),
        hash: this.#hash(row.text),
      }));
    } catch (e) {
      console.warn(`[PGVECTOR] BM25 search failed: ${e.message}`);
      return [];
    }
  }

  async searchVector(collection, queryVector, limit = 10) {
    const tableName = await this.#ensureTable(collection);
    const safeName = `"${tableName}"`;
    const vectorStr = `[${queryVector.join(',')}]`;

    try {
      const result = await this.pool.query(
        `SELECT text, metadata::text as meta, 1 - (embedding <=> $1::vector) as score
         FROM ${safeName}
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [vectorStr, limit]
      );

      return result.rows.map(row => ({
        text: row.text,
        metadata: row.meta ? JSON.parse(row.meta) : {},
        score: row.score,
        hash: this.#hash(row.text),
      }));
    } catch (e) {
      console.warn(`[PGVECTOR] Vector search failed: ${e.message}`);
      return [];
    }
  }

  async deleteCollection(collection) {
    const tableName = this.#tableName(collection);
    try {
      await this.pool.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
    } catch (e) {
      console.warn(`[PGVECTOR] deleteCollection failed: ${e.message}`);
    }
  }

  async listCollections() {
    try {
      const result = await this.pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name LIKE 'rag_%'`
      );
      return result.rows.map(r => r.table_name.replace(/^rag_/, ''));
    } catch (e) {
      console.warn(`[PGVECTOR] listCollections failed: ${e.message}`);
      return [];
    }
  }

  async count(collection) {
    const tableName = this.#tableName(collection);
    try {
      const result = await this.pool.query(
        `SELECT COUNT(*) as cnt FROM "${tableName}"`
      );
      return parseInt(result.rows[0].cnt) || 0;
    } catch {
      return 0;
    }
  }

  async close() {
    await this.pool.end();
  }
}

export function createPgVectorAdapter(options = {}) {
  return new PgVectorAdapter(options);
}
