import { spawn } from 'child_process';
import { join } from 'path';
import { logger } from './lib/logger.js';
import { buildSafeEnv } from './lib/safeEnv.js';
import { createModelStats } from './lib/modelStats.js';

// ===== __dirname for ESM =====
import { fileURLToPath } from 'url';
import { dirname as pathDirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

const FREE_CODE_DIR = process.env.FREE_CODE_DIR || (process.platform === 'win32' ? join(__dirname, '../..') : '/free-code');
const GLOBAL_PROCESS_LIMIT = parseInt(process.env.MAX_GLOBAL_PROCESSES || '8');
let globalProcessCount = 0;
const PROCESS_TIMEOUT = parseInt(process.env.PROCESS_TIMEOUT || '300000'); // 5 分钟
const modelStats = createModelStats();

function stripAnsi(str) {
  str = str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  str = str.replace(/\x1b\][^\x07]*\x07/g, '');
  str = str.replace(/\x1b\[[?]\d+[hl]/g, '');
  str = str.replace(/\x1b\[\d+;\d+[A-H]/g, '');
  str = str.replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(parseInt(n)));
  return str;
}

// Send message to all connected WebSocket clients for a session
function broadcastToSession(sessionClients, sessionId, message) {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;
  const data = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

// Push model health updates to connected WebSocket clients
function notifyModelUpdate(sessionClients, session) {
  broadcastToSession(sessionClients, session.id, {
    type: 'model_update',
    model: session.currentModel,
    health: session.modelHealth
  });
}

// --- API Key masking for terminal output ---
function maskSensitive(text, apiKey) {
  if (!apiKey) return text;
  if (apiKey.length < 12) {
    // 短 Key：屏蔽中间部分
    const mid = Math.floor(apiKey.length / 2);
    const masked = apiKey.substring(0, Math.max(1, mid - 2)) + '***' + apiKey.substring(mid + 2);
    return text.split(apiKey).join(masked);
  }
  const masked = apiKey.substring(0, 8) + '***' + apiKey.substring(apiKey.length - 4);
  return text.split(apiKey).join(masked);
}

function resolveOpenRouterModel(model, agentConfig) {
  const PROVIDERS = agentConfig.providers || {};
  const aliases = (PROVIDERS.openrouter || {}).modelAliases || {};
  return aliases[model] || model;
}

function getFallbackModel(provider, agentConfig) {
  const PROVIDERS = agentConfig.providers || {};
  return (PROVIDERS[provider] || {}).fallbackModel || null;
}

async function startProxy(session, agentConfig, sessionClients, sessionProxies) {
  const DEFAULTS = agentConfig.defaults || {};
  const PROVIDERS = agentConfig.providers || {};
  const proxyPath = join(FREE_CODE_DIR, 'or_proxy.mjs');
  const model = session.provider === 'openrouter'
    ? resolveOpenRouterModel(session.model || DEFAULTS.model, agentConfig)
    : (session.model || DEFAULTS.model || 'deepseek-chat');
  const fallback = getFallbackModel(session.provider, agentConfig);
  logger.info('Starting proxy', { model, fallback });

  const proxyArgs = [proxyPath, '--model', model];
  if (session.provider === 'deepseek') {
    proxyArgs.push('--base-url', 'https://api.deepseek.com/v1');
  }
  if (fallback && fallback !== model) {
    proxyArgs.push('--fallback-model', fallback);
  }

  const proxy = spawn('node', proxyArgs, {
    cwd: session.dir,
    env: buildSafeEnv({ ANTHROPIC_API_KEY: session.apiKey, NODE_ENV: 'production' }),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let proxyOutput = '';
  const portPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Proxy startup timeout')), 30000);
    proxy.stdout.on('data', (chunk) => {
      proxyOutput += chunk.toString();
      const portMatch = proxyOutput.match(/(?:port|listening)[^\d]*(\d{4,5})/i);
      if (portMatch) {
        clearTimeout(t);
        resolve(parseInt(portMatch[1], 10));
      }
    });
    proxy.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      logger.error('Proxy stderr', { text });

      // Parse model health events from proxy v5
      // "→ modelX" / "→ modelX [retry 1/2]" → retrying
      const switchingMatch = text.match(/\[proxy\] →\s+(\S+)/);
      if (switchingMatch) {
        session.modelHealth = 'retrying';
      }
      // "✓ modelX" → live
      const liveMatch = text.match(/\[proxy\] ✓\s+(\S+)/);
      if (liveMatch) {
        session.currentModel = liveMatch[1];
        session.modelHealth = 'ok';
        modelStats.recordSuccess(liveMatch[1]);
        notifyModelUpdate(sessionClients, session);
      }
      // "✗ all failed ... → code" → error
      if (text.includes('[proxy] ✗ all failed')) {
        session.modelHealth = 'error';
        const codeMatch = text.match(/→\s*(\S+)$/);
        const errCode = codeMatch ? codeMatch[1] : 'unknown';
        modelStats.recordFail(session.currentModel || session.model, errCode);
        notifyModelUpdate(sessionClients, session);
      }
    });
    proxy.on('error', (e) => { clearTimeout(t); reject(e); });
    proxy.on('close', (c) => { clearTimeout(t); reject(new Error('Proxy exited ' + c)); });
  });

  const port = await portPromise;
  logger.info('Proxy listening', { port });
  return { process: proxy, port };
}

async function spawnCli(session, prompt, agentConfig, sessionClients, sessionProxies) {
  // 全局进程限制
  if (globalProcessCount >= GLOBAL_PROCESS_LIMIT) {
    throw new Error('Server busy. Global process limit (' + GLOBAL_PROCESS_LIMIT + ') reached. Try again later.');
  }
  globalProcessCount++;
  let processCountActive = true;
  const releaseProcessSlot = () => {
    if (!processCountActive) return;
    processCountActive = false;
    globalProcessCount--;
  };

  try {
    const cliPath = join(FREE_CODE_DIR, 'cli-dev');
    const cliArgs = ['-p', '--bare'];
    if (session.model) cliArgs.push('--model', session.model);

    const env = buildSafeEnv({
      HOME: session.dir,
      ANTHROPIC_API_KEY: session.apiKey,
      NODE_ENV: 'production'
    });

    // For OpenRouter: start proxy and point CLI at it
    if (session.provider === 'openrouter' || session.provider === 'deepseek') {
      const { process: proxy, port } = await startProxy(session, agentConfig, sessionClients, sessionProxies);
      sessionProxies.set(session.id, proxy);
      env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + port;
      logger.info('CLI ANTHROPIC_BASE_URL', { url: env.ANTHROPIC_BASE_URL });
    }

    const proc = spawn(cliPath, cliArgs, {
      cwd: session.dir,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // 进程超时自动终止
    const processTimeout = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
        logger.warn('Process timed out', { timeout: PROCESS_TIMEOUT / 1000 });
      } catch (e) {
        // 进程可能已结束
      }
    }, PROCESS_TIMEOUT);

    const cleanupProcess = () => {
      clearTimeout(processTimeout);
      releaseProcessSlot();
    };

    proc.on('close', cleanupProcess);
    proc.on('error', cleanupProcess);

    proc.stdin.write(prompt + '\n');
    proc.stdin.end();

    return proc;
  } catch (e) {
    releaseProcessSlot();
    // 确保代理进程也被清理
    const proxy = sessionProxies.get(session.id);
    if (proxy) {
      try { proxy.kill(); } catch (_) {}
      sessionProxies.delete(session.id);
    }
    throw e;
  }
}

async function callModelWithTools(session, prompt, tools, agentConfig, sessionClients, sessionProxies) {
  const { response, releaseProcessSlot } = await callModelWithMessages(
    session, prompt, [{ role: 'user', content: [{ type: 'text', text: '' }] }], tools,
    agentConfig, sessionClients, sessionProxies
  );
  return { response, releaseProcessSlot };
}

/**
 * 支持多轮消息的模型调用（用于 tool_use 循环）
 * 发送完整消息历史，包含 tool_use / tool_result 内容块
 */
async function callModelWithMessages(session, systemPrompt, messages, tools, agentConfig, sessionClients, sessionProxies) {
  if (globalProcessCount >= GLOBAL_PROCESS_LIMIT) {
    throw new Error('Server busy. Global process limit (' + GLOBAL_PROCESS_LIMIT + ') reached. Try again later.');
  }
  globalProcessCount++;
  let processCountActive = true;
  const releaseProcessSlot = () => {
    if (!processCountActive) return;
    processCountActive = false;
    globalProcessCount--;
  };

  try {
    let baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';

    if (session.provider === 'openrouter' || session.provider === 'deepseek') {
      const { process: proxy, port } = await startProxy(session, agentConfig, sessionClients, sessionProxies);
      sessionProxies.set(session.id, proxy);
      baseUrl = 'http://127.0.0.1:' + port;
      logger.info('Model API URL', { url: baseUrl });
    }

    const model = session.provider === 'openrouter'
      ? resolveOpenRouterModel(session.model || agentConfig.defaults?.model, agentConfig)
      : (session.model || agentConfig.defaults?.model || 'deepseek-chat');

    const body = {
      model: model,
      max_tokens: 4096,
      temperature: 0.7,
      stream: true,
      system: systemPrompt,
      messages: messages
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.apiKey || ''}`
    };

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROCESS_TIMEOUT)
    });

    return { response, releaseProcessSlot };
  } catch (e) {
    releaseProcessSlot();
    const proxy = sessionProxies.get(session.id);
    if (proxy) {
      try { proxy.kill(); } catch (_) {}
      sessionProxies.delete(session.id);
    }
    throw e;
  }
}

export {
  stripAnsi,
  maskSensitive,
  broadcastToSession,
  notifyModelUpdate,
  startProxy,
  spawnCli,
  callModelWithTools,
  callModelWithMessages,
  resolveOpenRouterModel,
  getFallbackModel,
  modelStats,
  GLOBAL_PROCESS_LIMIT,
  PROCESS_TIMEOUT
};
