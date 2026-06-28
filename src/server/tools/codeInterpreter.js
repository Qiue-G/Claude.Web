import { spawn } from 'child_process';

export function executePython(code) {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-c', code], { timeout: 15000 });
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

export function codeInterpreterResult(code, { stdout, stderr, exitCode }) {
  const content = [];
  if (stdout) content.push(`[输出]\n${stdout.trim()}`);
  if (stderr) content.push(`[错误]\n${stderr.trim()}`);
  const text = content.join('\n\n') || '无输出';
  return {
    tool: 'code_interpreter',
    ok: exitCode === 0,
    content: text,
    metadata: { exitCode, codeLength: code.length, outputLength: text.length }
  };
}
