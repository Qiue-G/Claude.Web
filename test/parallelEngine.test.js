/**
 * ParallelEngine 单元测试
 *
 * 说明：
 * - 通过 createRequire 替换 child_process.spawn 来 mock 子进程
 * - 使用共享 mockConfig 对象控制 mock 行为，避免 ESM 模块缓存导致的 live binding 问题
 * - 验证 globalProcCount 的生命周期管理（关键修复验证）
 */
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const child_process = require('child_process');

const mockSession = {
  apiKey: 'test-api-key',
  dir: '/tmp/test-dir',
  provider: 'test',
};

const mockAgentConfig = {
  providers: {
    test_provider: {
      baseUrl: 'https://test.api.com',
      fallbackModel: '',
      models: [
        { id: 'model-a', name: 'Model A' },
        { id: 'model-b', name: 'Model B' },
        { id: 'model-c', name: 'Model C' },
      ],
    },
  },
};

// ─── 共享 mock 配置 ──────────────────────────────────────────────
// 使用对象包装，以便在测试间修改行为而不必替换 child_process.spawn
const mockConfig = {
  exitCode: 0,
  delayMs: 5,
};

/**
 * 创建一个 mock 子进程对象，在 delayMs 后 emit close
 */
function createMockProc(exitCode = 0, delayMs = 5) {
  const proc = new EventEmitter();
  proc.stdin = { write: mock.fn(), end: mock.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = mock.fn();
  proc.exitCode = null;

  setTimeout(() => {
    proc.exitCode = exitCode;
    proc.emit('close', exitCode);
  }, delayMs);

  return proc;
}

// ─── 一次性 mock 设置 + 模块加载 ────────────────────────────────
let ParallelEngine;

before(() => {
  // 设置共享的 spawn mock（所有测试共用同一个 spawn 引用）
  child_process.spawn = function sharedSpawnMock() {
    return createMockProc(mockConfig.exitCode, mockConfig.delayMs);
  };
  // 在模块加载前设定环境变量，GLOBAL_PROCESS_LIMIT 在模块顶层被解析为 const
  process.env.MAX_GLOBAL_PROCESSES = '2';
});

before(async () => {
  const mod = await import('../src/server/parallel/parallelEngine.js');
  ParallelEngine = mod.ParallelEngine;
});

after(() => {
  mock.reset();
  delete process.env.MAX_GLOBAL_PROCESSES;
});

// ─── 逻辑方法测试 ─────────────────────────────────────────────

describe('ParallelEngine — 逻辑方法', () => {
  describe('constructor', () => {
    it('should create instance with session and agentConfig', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      assert.ok(engine);
      assert.equal(engine.session, mockSession);
      assert.equal(engine.agentConfig, mockAgentConfig);
    });

    it('should initialize empty activeRuns map', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      assert.ok(engine.activeRuns instanceof Map);
      assert.equal(engine.activeRuns.size, 0);
    });

    it('should initialize callbacks as null', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      assert.equal(engine._onChunk, null);
      assert.equal(engine._onModelDone, null);
      assert.equal(engine._onAllDone, null);
    });
  });

  describe('callback registration', () => {
    it('onChunk should set callback and return this', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const fn = () => {};
      const result = engine.onChunk(fn);
      assert.equal(engine._onChunk, fn);
      assert.equal(result, engine);
    });

    it('onModelDone should set callback and return this', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const fn = () => {};
      const result = engine.onModelDone(fn);
      assert.equal(engine._onModelDone, fn);
      assert.equal(result, engine);
    });

    it('onAllDone should set callback and return this', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const fn = () => {};
      const result = engine.onAllDone(fn);
      assert.equal(engine._onAllDone, fn);
      assert.equal(result, engine);
    });
  });

  describe('getStatus()', () => {
    it('should return empty status when no runs', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const status = engine.getStatus();
      assert.ok(Array.isArray(status.running));
      assert.ok(Array.isArray(status.completed));
      assert.equal(status.activeCount, 0);
    });
  });

  describe('abort()', () => {
    it('should return false for unknown model', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const result = engine.abort('non-existent');
      assert.equal(result, false);
    });

    it('should set run status to aborted', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const killFn = mock.fn();
      engine.activeRuns.set('model-a', {
        modelId: 'model-a',
        proc: { kill: killFn, exitCode: null },
        proxy: null,
        status: 'running',
        startTime: Date.now(),
      });

      const result = engine.abort('model-a');
      assert.equal(result, true);
      assert.equal(engine.activeRuns.get('model-a').status, 'aborted');
    });

    it('should kill the process', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const killFn = mock.fn();
      engine.activeRuns.set('model-a', {
        modelId: 'model-a',
        proc: { kill: killFn, exitCode: null },
        proxy: null,
        status: 'running',
        startTime: Date.now(),
      });

      engine.abort('model-a');
      assert.equal(killFn.mock.calls.length, 1);
    });
  });

  describe('abortAll()', () => {
    it('should abort all running models', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const killFn1 = mock.fn();
      const killFn2 = mock.fn();

      engine.activeRuns.set('model-a', {
        modelId: 'model-a',
        proc: { kill: killFn1, exitCode: null },
        proxy: null,
        status: 'running',
        startTime: Date.now(),
      });
      engine.activeRuns.set('model-b', {
        modelId: 'model-b',
        proc: { kill: killFn2, exitCode: null },
        proxy: null,
        status: 'running',
        startTime: Date.now(),
      });

      engine.abortAll();

      assert.equal(killFn1.mock.calls.length, 1);
      assert.equal(killFn2.mock.calls.length, 1);
      assert.equal(engine.activeRuns.get('model-a').status, 'aborted');
      assert.equal(engine.activeRuns.get('model-b').status, 'aborted');
    });

    it('should handle empty activeRuns gracefully', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      engine.abortAll();
    });
  });

  describe('dispose()', () => {
    it('should clear activeRuns', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      engine.activeRuns.set('model-a', {
        modelId: 'model-a',
        proc: { kill: mock.fn(), exitCode: null },
        proxy: null,
        status: 'done',
        startTime: Date.now(),
      });

      assert.equal(engine.activeRuns.size, 1);
      engine.dispose();
      assert.equal(engine.activeRuns.size, 0);
    });

    it('should handle empty state gracefully', async () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      await engine.dispose();
      assert.equal(engine.activeRuns.size, 0);
    });
  });

  describe('_resolveModelConfig()', () => {
    it('should return config for known model', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const config = engine._resolveModelConfig('model-a');
      assert.ok(config);
      assert.equal(config.provider, 'test_provider');
      assert.equal(config.model.id, 'model-a');
    });

    it('should return null for unknown model', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const config = engine._resolveModelConfig('unknown-model');
      assert.equal(config, null);
    });
  });

  describe('_generateSummary()', () => {
    it('should return empty summary for empty results', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const summary = engine._generateSummary(new Map());
      assert.equal(summary.modelCount, 0);
    });

    it('should compute average latency for successful runs', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const results = new Map([
        ['model-a', { status: 'done', latency: 100, tokens: { output: 50 }, text: 'hello' }],
        ['model-b', { status: 'done', latency: 200, tokens: { output: 150 }, text: 'world' }],
      ]);

      const summary = engine._generateSummary(results);
      assert.equal(summary.modelCount, 2);
      assert.equal(summary.successCount, 2);
      assert.equal(summary.failCount, 0);
      assert.equal(summary.avgLatency, 150);
      assert.equal(summary.totalTokens, 200);
    });

    it('should track failed models', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const results = new Map([
        ['model-a', { status: 'done', latency: 100, tokens: { output: 50 }, text: 'hello' }],
        ['model-b', { status: 'error', latency: 0, tokens: {}, text: '', error: 'timeout' }],
      ]);

      const summary = engine._generateSummary(results);
      assert.equal(summary.successCount, 1);
      assert.equal(summary.failCount, 1);
      assert.deepEqual(summary.failedModels, ['model-b']);
    });

    it('should include length comparison for 2+ successful models', () => {
      const engine = new ParallelEngine(mockSession, mockAgentConfig);
      const results = new Map([
        ['model-a', { status: 'done', latency: 100, tokens: { output: 50 }, text: 'short' }],
        ['model-b', { status: 'done', latency: 200, tokens: { output: 150 }, text: 'a longer response' }],
      ]);

      const summary = engine._generateSummary(results);
      assert.ok(summary.lengthComparison);
      assert.equal(summary.lengthComparison.length, 2);
      assert.equal(summary.lengthComparison[0].modelId, 'model-b');
      assert.equal(summary.lengthComparison[1].modelId, 'model-a');
    });
  });
});

// ─── start() — 验证路径测试 ──────────────────────────────────────

describe('ParallelEngine — start() 验证路径', () => {
  it('should throw when no valid models match', async () => {
    const engine = new ParallelEngine(mockSession, { providers: {} });
    await assert.rejects(
      () => engine.start('test', ['unknown-model']),
      /No valid models to run/
    );
  });

  it('should throw when modelIds array is empty', async () => {
    const engine = new ParallelEngine(mockSession, { providers: {} });
    await assert.rejects(
      () => engine.start('test', []),
      /No valid models to run/
    );
  });
});

// ─── start() — 成功路径测试（exit code 0） ──────────────────────

describe('ParallelEngine — start() 成功', () => {
  before(() => {
    mockConfig.exitCode = 0;
  });

  it('should return results for all valid models', async () => {
    const engine = new ParallelEngine(mockSession, mockAgentConfig);
    const result = await engine.start('test prompt', ['model-a', 'model-b']);

    assert.ok(result);
    assert.ok(result.results);
    assert.ok(result.summary);
    assert.equal(result.results['model-a'].status, 'done');
    assert.ok(result.results['model-a'].latency >= 0);
    assert.equal(result.results['model-b'].status, 'done');
    assert.ok(result.results['model-b'].latency >= 0);
  });

  it('should track runs in activeRuns after start', async () => {
    const engine = new ParallelEngine(mockSession, mockAgentConfig);
    await engine.start('test', ['model-a']);

    assert.ok(engine.activeRuns.has('model-a'));
    const run = engine.activeRuns.get('model-a');
    assert.ok(run.startTime);
    assert.ok(run.endTime);
    assert.equal(run.status, 'done');
  });

  it('should generate summary with model count', async () => {
    const engine = new ParallelEngine(mockSession, mockAgentConfig);
    const result = await engine.start('test', ['model-a', 'model-b']);

    assert.equal(result.summary.modelCount, 2);
    assert.equal(result.summary.successCount, 2);
    assert.equal(result.summary.failCount, 0);
    assert.ok(result.summary.avgLatency >= 0);
    assert.ok(result.summary.totalTokens >= 0);
  });

  it('should invoke onAllDone with results and summary', async () => {
    const engine = new ParallelEngine(mockSession, mockAgentConfig);
    let allDoneData = null;

    engine.onAllDone((data) => {
      allDoneData = data;
    });

    await engine.start('test', ['model-a', 'model-b']);

    assert.ok(allDoneData);
    assert.ok(allDoneData.results);
    assert.ok(allDoneData.summary);
    assert.equal(allDoneData.summary.modelCount, 2);
  });

  it('should return completed runs via getStatus after start', async () => {
    const engine = new ParallelEngine(mockSession, mockAgentConfig);
    await engine.start('test', ['model-a']);

    const status = engine.getStatus();
    assert.equal(status.completed.length, 1);
    assert.equal(status.completed[0].modelId, 'model-a');
    assert.equal(status.completed[0].status, 'done');
  });

  it('should allow dispose after start', async () => {
    const engine = new ParallelEngine(mockSession, mockAgentConfig);
    await engine.start('test', ['model-a']);
    await engine.dispose();
    assert.equal(engine.activeRuns.size, 0);
  });
});

// ─── start() — 错误路径测试（exit code 1） ──────────────────────

describe('ParallelEngine — start() 进程错误', () => {
  before(() => {
    mockConfig.exitCode = 1;
  });

  it('should handle model with exit code 1 as error', async () => {
    const engine = new ParallelEngine(mockSession, mockAgentConfig);
    const result = await engine.start('test', ['model-a']);

    assert.equal(result.results['model-a'].status, 'error');
    assert.ok(result.results['model-a'].error);
  });
});

// ─── globalProcCount 管理测试（关键修复验证） ──────────────────

describe('ParallelEngine — globalProcCount management（关键修复验证）', () => {
  before(() => {
    mockConfig.exitCode = 0;
  });

  it('should allow start when under process limit', async () => {
    const engine = new ParallelEngine(mockSession, mockAgentConfig);
    const result = await engine.start('test', ['model-a', 'model-b']);
    assert.equal(result.summary.modelCount, 2);
  });

  it('should throw Server busy when would exceed process limit', async () => {
    const engine1 = new ParallelEngine(mockSession, mockAgentConfig);
    const engine2 = new ParallelEngine(mockSession, mockAgentConfig);

    // 同步启动两个 engine：engine1 先同步执行 globalProcCount += configCount
    // 然后 engine2 同步检查时发现已达到上限
    const p1 = engine1.start('test', ['model-a', 'model-b']);
    const p2 = engine2.start('test', ['model-a', 'model-b']);

    const result2 = await p2.catch((e) => ({ error: e }));
    assert.ok(result2.error, 'engine2 should throw');
    assert.match(result2.error.message, /Server busy/);

    // 等待 engine1 完成，避免悬挂
    await p1.catch(() => {});
  });

  it('should free process count after dispose()（关键修复验证）', async () => {
    const engine1 = new ParallelEngine(mockSession, mockAgentConfig);
    await engine1.start('test', ['model-a', 'model-b']);

    // start() 的 try/finally 已释放 globalProcCount
    // 因此可以再次启动
    const engine2 = new ParallelEngine(mockSession, mockAgentConfig);
    const result = await engine2.start('test', ['model-a', 'model-b']);
    assert.equal(result.summary.modelCount, 2);
  });
});
