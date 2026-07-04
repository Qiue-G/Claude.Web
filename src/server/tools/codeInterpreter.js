import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';
const AST_CHECKER = path.join(__dirname, 'python_ast_checker.py');

/**
 * 第一层防护：AST 安全分析
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
 * 执行 Python 代码（带 AST 安全检查）
 */
export async function executePython(code) {
  // 第一层：AST 安全检查
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

  // 第二层：实际执行（未来 Docker 容器隔离）
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_CMD, ['-c', code], { timeout: 15000 });
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ stdout: '', stderr: '[超时] 执行超过 15 秒', exitCode: -1 });
    }, 15000);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', data => stdout += data.toString());
    proc.stderr.on('data', data => stderr += data.toString());
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
