/**
 * Parallel Engine — 并行模型调用引擎
 *
 * 功能：
 * 1. 将同一 prompt 并行发送给多个模型
 * 2. 每个模型独立运行，互不影响
 * 3. 多路输出流复用（区分模型来源）
 * 4. 结果聚合与对比摘要生成
 * 5. 支持中止单个模型的运行
 *
 * 架构说明：
 * - 每个并行模型创建独立的临时 session + CLI 进程 + proxy（如果需要）
 * - 所有模型通过 Promise.allSettled 并发执行
 * - 输出块通过 streamMuxer 添加 { modelId } 标签
 * - 单个模型失败不影响其他模型
 */
import { spawn } from 'child_process';
import { join } from 'path';
import { logger } from '../lib/logger.js';
import { modelStats } from '../lib/modelStats.js';
import { buildSafeEnv } from '../lib/safeEnv.js';

const FREE_CODE_DIR = process.env.FREE_CODE_DIR || process.cwd();
const GLOBAL_PROCESS_LIMIT = parseInt(process.env.MAX_GLOBAL_PROCESSES || '16', 10);
const MODEL_TIMEOUT_MS = parseInt(process.env.MODEL_TIMEOUT_MS || '300000', 10); // 5 min

let globalProcCount = 0;

/**
 * 启动 or_proxy.mjs 进程
 */
function startProxy(modelId, apiKey, baseUrl, fallbackModel) {
  return new Promise((resolve, reject) => {
    const proxyPath = join(FREE_CODE_DIR, 'or_proxy.mjs');
    const proxy = spawn('node', [proxyPath], {
      env: buildSafeEnv({
        OR_PROXY_MODEL: modelId,
        OR_PROXY_API_KEY: apiKey,
        OR_PROXY_BASE_URL: baseUrl || 'https://openrouter.ai/api/v1/chat/completions',
        OR_PROXY_FALLBACK: fallbackModel || '',
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      reject(new Error(`Proxy startup timeout for ${modelId}`));
    }, 30000);

    proxy.stdout.on('data', (data) => {
      const text = data.toString();
      const portMatch = text.match(/listening on port (\d+)/i) || text.match(/port[=:]?\s*(\d+)/);
      if (portMatch) {
        clearTimeout(timeout);
        resolve({ process: proxy, port: parseInt(portMatch[1], 10) });
      }
    });

    proxy.stderr.on('data', () => { /* proxy debug output */ });

    proxy.on('error', (e) => { clearTimeout(timeout); reject(e); });
    proxy.on('close', (c) => { clearTimeout(timeout); reject(new Error(`Proxy exited ${c}`)); });
  });
}

/**
 * 启动单个 CLI 进程用于并行调用
 */
function spawnCliForModel(session, modelId, prompt) {
  return new Promise((resolve, reject) => {
    const cliPath = join(FREE_CODE_DIR, 'cli-dev');
    const cliArgs = ['-p', '--bare', '--model', modelId];
    const env = buildSafeEnv({
      HOME: session.dir,
      ANTHROPIC_API_KEY: session.apiKey,
      NODE_ENV: 'production',
    });

    // 如果需要 proxy（OpenRouter/DeepSeek）
    const useProxy = session.provider === 'openrouter' || session.provider === 'deepseek';
    let proxyProcess = null;

    (async () => {
      if (useProxy) {
        try {
          const { process: proxy, port } = await startProxy(
            modelId,
            session.apiKey,
            session.baseUrl,
            session.fallbackModel
          );
          proxyProcess = proxy;
          env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + port;
        } catch (e) {
          return reject(new Error(`Proxy failed for ${modelId}: ${e.message}`));
        }
      }

      const proc = spawn(cliPath, cliArgs, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // 发送 prompt 到 CLI
      proc.stdin.write(prompt + '\n');
      proc.stdin.end();

      resolve({ proc, proxy: proxyProcess });
    })();
  });
}

/**
 * 并行调用引擎
 */
class ParallelEngine {
  constructor(session, agentConfig) {
    this.session = session;
    this.agentConfig = agentConfig;
    this.activeRuns = new Map(); // modelId → { proc, proxy, chunks, stats }
    this._onChunk = null;
    this._onModelDone = null;
    this._onAllDone = null;
  }

  /**
   * 设置回调
   */
  onChunk(fn) { this._onChunk = fn; return this; }
  onModelDone(fn) { this._onModelDone = fn; return this; }
  onAllDone(fn) { this._onAllDone = fn; return this; }

  /**
   * 开始并行调用
   * @param {string} prompt - 用户提示
   * @param {string[]} modelIds - 模型 ID 列表
   * @returns {Promise<Object>} 聚合结果
   */
  async start(prompt, modelIds) {
    const results = new Map();
    const runConfigs = [];

    for (const modelId of modelIds) {
      const config = this._resolveModelConfig(modelId);
      if (!config) {
        logger.warn('[Parallel] Unknown model', { modelId });
        continue;
      }
      runConfigs.push({ modelId, config });
    }

    const configCount = runConfigs.length;

    if (configCount === 0) {
      throw new Error('No valid models to run');
    }

    if (globalProcCount + configCount > GLOBAL_PROCESS_LIMIT) {
      throw new Error(`Server busy. Would exceed process limit (${GLOBAL_PROCESS_LIMIT}).`);
    }

    globalProcCount += configCount;

    try {
      const promises = runConfigs.map(async ({ modelId, config }) => {
      const run = {
        modelId,
        config,
        chunks: [],
        text: '',
        tokens: { input: 0, output: 0 },
        startTime: Date.now(),
        endTime: null,
        status: 'running',
        error: null,
      };
      this.activeRuns.set(modelId, run);

      try {
        const { proc, proxy } = await spawnCliForModel(this.session, modelId, prompt);
        run.proc = proc;
        run.proxy = proxy;
        run.spawnTime = Date.now();

        // 设置超时
        const procTimeout = setTimeout(() => {
          if (run.status === 'running') {
            run.status = 'error';
            run.error = 'timeout';
            proc.kill('SIGKILL');
          }
        }, MODEL_TIMEOUT_MS);

        // 收集 stdout
        proc.stdout.on('data', (data) => {
          const text = data.toString();
          run.chunks.push(text);
          run.text += text;

          // 估计 token 数
          run.tokens.output += Math.ceil(text.length / 4);

          // 发送带模型标签的块
          if (this._onChunk) {
            this._onChunk({
              modelId,
              text,
              index: run.chunks.length - 1,
              done: false,
            });
          }
        });

        // 收集 stderr（状态信息）
        proc.stderr.on('data', () => { /* ignore debug output */ });

        // 等待退出
        await new Promise((resolveExit) => {
          proc.on('close', (code) => {
            clearTimeout(procTimeout);
            run.endTime = Date.now();
            run.exitCode = code;
            run.status = code === 0 ? 'done' : 'error';
            if (code !== 0) run.error = `exit_${code}`;
            resolveExit();
          });
        });

      } catch (e) {
        run.endTime = Date.now();
        run.status = 'error';
        run.error = e.message;
        logger.error('[Parallel] Model run failed', { modelId, error: e.message });
      }

      run.latency = run.endTime - run.startTime;

      // 清理 proxy
      if (run.proxy) {
        try { run.proxy.kill(); } catch (_) { /* ignore */ }
      }

      // 清理 CLI 进程
      if (run.proc && run.proc.exitCode === null) {
        try { run.proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
      }

      // 记录模型统计
      if (run.status === 'done') {
        modelStats.recordSuccess(modelId);
      } else {
        modelStats.recordFail(modelId, run.error);
      }

      if (this._onModelDone) {
        this._onModelDone({
          modelId,
          status: run.status,
          latency: run.latency,
          tokens: run.tokens,
          text: run.text,
          error: run.error,
        });
      }

      results.set(modelId, {
        status: run.status,
        latency: run.latency,
        tokens: run.tokens,
        text: run.text,
        error: run.error,
      });

      return run;
    });

    await Promise.allSettled(promises);

    // 生成聚合摘要
    const summary = this._generateSummary(results);

    if (this._onAllDone) {
      this._onAllDone({ results: Object.fromEntries(results), summary });
    }

    return { results: Object.fromEntries(results), summary };
    } finally {
      globalProcCount = Math.max(0, globalProcCount - configCount);
    }
  }

  /**
   * 中止指定模型的运行
   */
  abort(modelId) {
    const run = this.activeRuns.get(modelId);
    if (!run) return false;
    if (run.proc && run.proc.exitCode === null) {
      run.proc.kill('SIGKILL');
    }
    if (run.proxy) {
      try { run.proxy.kill(); } catch (_) { /* ignore */ }
    }
    run.status = 'aborted';
    run.endTime = Date.now();
    return true;
  }

  /**
   * 中止所有运行
   */
  abortAll() {
    for (const modelId of this.activeRuns.keys()) {
      this.abort(modelId);
    }
  }

  /**
   * 获取运行状态
   */
  getStatus() {
    const running = [];
    const completed = [];
    for (const [modelId, run] of this.activeRuns) {
      const info = {
        modelId,
        status: run.status,
        latency: run.endTime ? run.endTime - run.startTime : Date.now() - run.startTime,
        tokens: run.tokens,
      };
      if (run.status === 'running' || run.status === 'starting') {
        running.push(info);
      } else {
        completed.push(info);
      }
    }
    return { running, completed, activeCount: this.activeRuns.size };
  }

  /**
   * 释放所有资源
   */
  async dispose() {
    this.abortAll();
    this.activeRuns.clear();
    // globalProcCount 现在由 start() 的 try/finally 管理
  }

  /**
   * 解析模型配置
   */
  _resolveModelConfig(modelId) {
    const providers = this.agentConfig?.providers || {};
    for (const [providerName, providerConfig] of Object.entries(providers)) {
      const models = providerConfig.models || [];
      for (const m of models) {
        if (m.id === modelId) {
          return {
            provider: providerName,
            baseUrl: providerConfig.baseUrl,
            fallbackModel: providerConfig.fallbackModel,
            model: m,
          };
        }
      }
    }
    return null;
  }

  /**
   * 生成对比摘要
   */
  _generateSummary(results) {
    const models = Array.from(results.entries());
    if (models.length === 0) return { modelCount: 0 };

    const successful = models.filter(([_, r]) => r.status === 'done');
    const failed = models.filter(([_, r]) => r.status !== 'done');

    const summary = {
      modelCount: models.length,
      successCount: successful.length,
      failCount: failed.length,
      avgLatency: successful.length > 0
        ? Math.round(successful.reduce((s, [_, r]) => s + r.latency, 0) / successful.length)
        : 0,
      totalTokens: successful.reduce((s, [_, r]) => s + (r.tokens?.output || 0), 0),
      failedModels: failed.map(([id]) => id),
    };

    // 文本长度对比
    if (successful.length >= 2) {
      const texts = successful.map(([id, r]) => ({ modelId: id, length: r.text.length }));
      texts.sort((a, b) => b.length - a.length);
      summary.lengthComparison = texts;
    }

    return summary;
  }
}

export { ParallelEngine };
