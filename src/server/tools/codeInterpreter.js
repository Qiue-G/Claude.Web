import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import { buildSafeEnv } from '../lib/safeEnv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';
const AST_CHECKER = path.join(__dirname, 'python_ast_checker.py');
const DOCKER_SANDBOX = path.join(__dirname, 'dockerSandbox.py');

// 全局并发控制（第5层）
const MAX_CONCURRENT = 5;
let activeExecutions = 0;

// 输出大小限制（第2层）
const MAX_OUTPUT = 1024 * 1024; // 1MB

// 代码大小限制（第4层）
const MAX_CODE_SIZE = 100 * 1024; // 100KB

// 全局并发控制（第5层）

/**
 * 第1层防护：AST 安全分析
 * 在执行 Python 代码前，通过 AST 分析检查是否包含危险操作
 */
function astSecurityCheck(code) {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_CMD, [AST_CHECKER], {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      proc.kill();
      // AST 检查超时，保守起见阻止执行
      resolve({
        safe: false,
        violations: [{ line: 0, col: 0, message: '安全检查超时', severity: 'high' }],
        summary: '安全检查超时，已阻止执行',
      });
    }, 5000);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => { stdout += data.toString(); });
    proc.stderr.on('data', data => { stderr += data.toString(); });

    proc.on('close', exitCode => {
      clearTimeout(timeout);
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch {
        // 解析失败，保守起见阻止执行
        resolve({
          safe: false,
          violations: [{ line: 0, col: 0, message: `安全检查解析失败: ${stderr.trim() || '未知错误'}`, severity: 'high' }],
          summary: '安全检查异常，已阻止执行',
        });
      }
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      // Python 不可用，保守起见阻止执行
      resolve({
        safe: false,
        violations: [{ line: 0, col: 0, message: '无法启动安全检查（Python 不可用）', severity: 'high' }],
        summary: '安全检查无法启动，已阻止执行',
      });
    });

    proc.stdin.write(code);
    proc.stdin.end();
  });
}

/**
 * 第8层：Docker 回退
 * 优先使用独立 dockerSandbox.py 脚本，不可用时回退到内联 Docker 执行
 */
async function tryDockerExecute(code) {
  // 检测 Docker 是否可用
  try {
    const { execSync } = await import('child_process');
    execSync('docker --version', { stdio: 'ignore', timeout: 3000 });
  } catch {
    return null; // Docker not available
  }

  // 优先使用独立沙箱脚本（支持文件挂载、非 root 用户等）
  if (fs.existsSync(DOCKER_SANDBOX)) {
    return new Promise((resolve) => {
      const proc = spawn(PYTHON_CMD, [DOCKER_SANDBOX], {
        timeout: 35000,
        env: buildSafeEnv(),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        proc.kill();
        resolve({ stdout, stderr: '[超时] Docker 沙箱执行超过 30 秒', exitCode: -1 });
      }, 35000);

      proc.stdout.on('data', d => {
        if (stdout.length < MAX_OUTPUT) stdout += d.toString().slice(0, MAX_OUTPUT - stdout.length);
      });
      proc.stderr.on('data', d => {
        if (stderr.length < MAX_OUTPUT) stderr += d.toString().slice(0, MAX_OUTPUT - stderr.length);
      });
      proc.on('close', () => {
        clearTimeout(timeout);
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          resolve({ stdout, stderr: stderr || 'Docker sandbox output parse failed', exitCode: -1 });
        }
      });
      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(null); // 回退到内联执行
      });

      proc.stdin.write(code);
      proc.stdin.end();
    });
  }

  // 回退：内联 Docker 执行
  return new Promise((resolve) => {
    const proc = spawn('docker', [
      'run', '--rm', '--network', 'none',
      '--memory', '256m', '--cpus', '0.5',
      '--read-only', '--tmpfs', '/tmp:size=64m',
      'python:3.12-slim',
      'python', '-c', code,
    ], { timeout: 30000, env: buildSafeEnv() });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ stdout, stderr: '[超时] Docker 执行超过 30 秒', exitCode: -1 });
    }, 30000);

    proc.stdout.on('data', d => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString().slice(0, MAX_OUTPUT - stdout.length);
    });
    proc.stderr.on('data', d => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString().slice(0, MAX_OUTPUT - stderr.length);
    });
    proc.on('close', code => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code });
    });
    proc.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

/**
 * 第2/3/7层：带资源限制和输出大小限制的执行
 * - Linux: 使用 ulimit 包装 + 进程组清理
 * - Windows: 仅超时 + 临时目录隔离
 */
function executeWithLimits(code, cwd) {
  return new Promise((resolve) => {
    let cmd;
    let args;

    // 将代码写入临时文件后执行（所有平台），避免：
    // 1. Windows 下 python -c 在 G:\tmp 创建泄露的临时文件
    // 2. shell 注入风险
    // 临时文件在 cwd(py-sandbox-*) 内，由调用方 cleanup 自动删除
    const tmpFile = path.join(cwd, `_exec_${Date.now()}.py`);
    fs.writeFileSync(tmpFile, code, 'utf-8');

    if (process.platform === 'linux') {
      cmd = '/bin/sh';
      args = ['-c', `ulimit -v 262144; ulimit -u 50; ulimit -f 10240; exec ${PYTHON_CMD} "${tmpFile}"`];
    } else {
      // Windows: 不设置 ulimit，仅使用超时 + 临时目录隔离
      cmd = PYTHON_CMD;
      args = [tmpFile];
    }

    const proc = spawn(cmd, args, {
      timeout: 15000,
      cwd,
      // 覆盖 TMP/TEMP 指向沙箱目录，使 Python 的临时文件也在沙箱内，随沙箱一起清理
      env: buildSafeEnv({ TMP: cwd, TEMP: cwd }),
      // Linux detached=true 使子进程拥有独立进程组，便于清理（第3层）
      ...(process.platform === 'linux' ? { detached: true } : {}),
    });

    const timeout = setTimeout(() => {
      if (process.platform === 'linux' && proc.pid) {
        // 杀死整个进程组（第3层：进程组清理）
        try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
      } else {
        proc.kill('SIGKILL');
      }
      resolve({ stdout: '', stderr: '[超时] 执行超过 15 秒', exitCode: -1 });
    }, 15000);

    let stdout = '';
    let stderr = '';

    // 第2层：输出大小限制
    proc.stdout.on('data', data => {
      if (stdout.length >= MAX_OUTPUT) {
        proc.kill('SIGKILL');
        proc.stdout.destroy();
        return;
      }
      stdout += data.toString().slice(0, MAX_OUTPUT - stdout.length);
    });

    proc.stderr.on('data', data => {
      if (stderr.length >= MAX_OUTPUT) {
        proc.kill('SIGKILL');
        proc.stderr.destroy();
        return;
      }
      stderr += data.toString().slice(0, MAX_OUTPUT - stderr.length);
    });

    proc.on('close', exitCode => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode });
    });

    proc.on('error', error => {
      clearTimeout(timeout);
      resolve({ stdout: '', stderr: '无法启动 Python: ' + error.message, exitCode: -1 });
    });
  });
}

/**
 * 执行 Python 代码（多层沙箱防护）
 * 返回 { stdout, stderr, exitCode, blocked, violations }
 */
export async function executePython(code) {
  // 第4层：代码大小限制
  if (code.length > MAX_CODE_SIZE) {
    return {
      stdout: '',
      stderr: '[安全拦截] 代码超过 100KB 限制',
      exitCode: -1,
      blocked: true,
    };
  }

  // 第5层：全局并发限流
  if (activeExecutions >= MAX_CONCURRENT) {
    return {
      stdout: '',
      stderr: '[系统繁忙] 请稍后重试（当前并发执行已达上限）',
      exitCode: -1,
      blocked: true,
    };
  }

  activeExecutions++;

  try {
    // 第6层：AST 检查器输入大小限制（code 已在第4层检查不超过 100KB）
    // 第1层：AST 安全检查
    const checkResult = await astSecurityCheck(code);

    if (!checkResult.safe) {
      return {
        stdout: '',
        stderr: `[安全拦截] ${checkResult.summary}\n\n违规详情:\n${checkResult.violations.map(v => `  第${v.line}行: ${v.message}`).join('\n')}`,
        exitCode: -1,
        blocked: true,
        violations: checkResult.violations,
      };
    }

    // 第8层：Docker 回退 — 优先尝试 Docker 执行
    const dockerResult = await tryDockerExecute(code);
    if (dockerResult !== null) return dockerResult;

    // 第9层：临时目录隔离
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'py-sandbox-'));
    try {
      return await executeWithLimits(code, tmpDir);
    } finally {
      // 执行完成后清理临时目录
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    activeExecutions--;
  }
}

export function extractPythonBlocks(text) {
  const blocks = [];
  const regex = /```(?:python|py)\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const code = match[1].trim();
    if (code) blocks.push(code);
  }
  return blocks;
}

export function codeInterpreterResult(code, { stdout, stderr, exitCode, blocked }) {
  const content = [];
  if (blocked) {
    content.push(`[安全拦截] ${stderr}`);
  } else {
    if (stdout) content.push(`[输出]\n${stdout.trim()}`);
    if (stderr) content.push(`[错误]\n${stderr.trim()}`);
  }
  const text = content.join('\n\n') || '无输出';
  return {
    tool: 'code_interpreter',
    ok: !blocked && exitCode === 0,
    content: text,
    metadata: { exitCode, codeLength: code.length, outputLength: text.length, blocked: !!blocked }
  };
}
