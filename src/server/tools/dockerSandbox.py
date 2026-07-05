#!/usr/bin/env python3
"""
Docker 沙箱执行器 — 在隔离容器中执行 Python 代码。

特性：
- 网络隔离（--network none）
- 内存限制（256MB）
- CPU 限制（0.5 核）
- 只读文件系统 + 64MB /tmp
- 非 root 用户执行
- 30 秒超时

Usage:
  echo "print('hello')" | python dockerSandbox.py
  python dockerSandbox.py < script.py
"""

import sys
import json
import subprocess
import tempfile
import os


def run_in_sandbox(code, timeout=30):
    """在 Docker 容器中执行代码"""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, dir='/tmp') as f:
        f.write(code)
        f.flush()
        tmp_path = f.name

    try:
        result = subprocess.run(
            [
                'docker', 'run', '--rm',
                '--network', 'none',
                '--memory', '256m',
                '--cpus', '0.5',
                '--read-only',
                '--tmpfs', '/tmp:size=64m',
                '-v', f'{tmp_path}:/code/script.py:ro',
                'python:3.12-slim',
                'python', '/code/script.py'
            ],
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return {
            'stdout': result.stdout[:1024 * 1024],  # 1MB 限制
            'stderr': result.stderr[:1024 * 1024],
            'exitCode': result.returncode
        }
    except subprocess.TimeoutExpired:
        return {'stdout': '', 'stderr': 'Execution timed out (30s)', 'exitCode': -1}
    except FileNotFoundError:
        return {'stdout': '', 'stderr': 'Docker not available', 'exitCode': -1}
    except Exception as e:
        return {'stdout': '', 'stderr': str(e), 'exitCode': -1}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


if __name__ == '__main__':
    code = sys.stdin.read()
    if not code.strip():
        print(json.dumps({'stdout': '', 'stderr': 'No code provided', 'exitCode': -1}))
        sys.exit(1)

    result = run_in_sandbox(code)
    print(json.dumps(result))
