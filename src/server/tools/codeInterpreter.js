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
