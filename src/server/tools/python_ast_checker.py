"""
Python AST 安全分析脚本
从 stdin 读取代码，输出 JSON 分析结果
用于代码解释器执行前的安全验证（第一层防护）

环境变量：
  PERMISSIVE_MODE=1  宽松模式：只禁止代码注入类函数，允许常用模块（os/sys/subprocess 等）
                     适用于单用户部署环境（如 Railway 个人实例）
"""
import ast
import sys
import json
import os

# 检测宽松模式
PERMISSIVE_MODE = os.environ.get('PERMISSIVE_MODE', '0') == '1'

# 禁止导入的模块（严格模式）
DANGEROUS_IMPORTS = {
    'os', 'sys', 'subprocess', 'shutil', 'socket',
    'ctypes', 'multiprocessing', 'signal', 'pty',
    'webbrowser', 'http.server', 'ftplib', 'telnetlib',
    'xmlrpc', 'smtplib', 'poplib', 'imaplib',
    'sqlite3', 'dbm', 'gdbm',
    'pickle', 'shelve', 'marshal',
    'tempfile', 'glob', 'fnmatch',
    'platform', 'pwd', 'grp', 'spwd',
    'resource', 'select', 'selectors',
    'asyncio', 'threading', '_thread',
    # 动态导入/反射模块（可绕过静态 import 检查）
    'importlib', 'pkgutil',
}

# 允许的模块
SAFE_IMPORTS = {
    'math', 'cmath', 'decimal', 'fractions',
    'random', 'statistics',
    'json', 're', 'string',
    'collections', 'itertools', 'functools',
    'operator', 'copy', 'pprint',
    'datetime', 'time', 'calendar',
    'hashlib', 'hmac', 'secrets', 'base64',
    'binascii', 'struct', 'codecs',
    'unicodedata', 'textwrap', 'difflib',
    'enum', 'abc', 'typing', 'dataclasses',
    'contextlib', 'types',
    'inspect', 'dis', 'traceback',
    'warnings', 'weakref',
    'array', 'bisect', 'heapq', 'queue',
    'io', 'csv', 'configparser',
    'html',
    'logging',
    'unittest', 'doctest',
    'numbers',
}

# 禁止的函数调用（所有模式）
# 这些是代码注入类函数，任何模式下都应禁止
DANGEROUS_FUNCTIONS = {
    'exec', 'eval', 'compile',
    '__import__',
}

# 宽松模式下额外禁止的函数
PERMISSIVE_DANGEROUS_FUNCTIONS = {
    'input', 'breakpoint', 'exit', 'quit',
    'globals', 'locals', 'vars',
    'getattr', 'setattr', 'delattr',
}

# 禁止的属性访问（所有模式）
DANGEROUS_ATTRIBUTES = {
    '__class__', '__bases__', '__subclasses__',
    '__mro__', '__init__', '__new__', '__del__',
    '__getattribute__', '__setattr__', '__delattr__',
    '__reduce__', '__reduce_ex__',
    '__code__', '__globals__', '__builtins__',
    '__loader__', '__spec__', '__package__',
    '__file__', '__path__', '__dict__', '__weakref__',
}


class SecurityAnalyzer(ast.NodeVisitor):
    def __init__(self):
        self.violations = []

    def _violation(self, node, message, severity='high'):
        self.violations.append({
            'line': getattr(node, 'lineno', 0),
            'col': getattr(node, 'col_offset', 0),
            'message': message,
            'severity': severity,
        })

    def visit_Import(self, node):
        if not PERMISSIVE_MODE:
            for alias in node.names:
                name = alias.name
                if name in DANGEROUS_IMPORTS:
                    self._violation(node, f"禁止导入危险模块: {name}", 'high')
                elif name not in SAFE_IMPORTS and not name.startswith('.'):
                    self._violation(node, f"未授权导入模块: {name}", 'medium')
        # 宽松模式：允许所有模块导入
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if not PERMISSIVE_MODE:
            module = node.module or ''
            if module in DANGEROUS_IMPORTS:
                self._violation(node, f"禁止从危险模块导入: {module}", 'high')
            elif module not in SAFE_IMPORTS and not module.startswith('.'):
                self._violation(node, f"未授权从模块导入: {module}", 'medium')
        # 宽松模式：允许从所有模块导入
        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name):
            if node.func.id in DANGEROUS_FUNCTIONS:
                self._violation(node, f"禁止调用危险函数: {node.func.id}()", 'high')
            elif not PERMISSIVE_MODE and node.func.id in PERMISSIVE_DANGEROUS_FUNCTIONS:
                self._violation(node, f"禁止调用函数: {node.func.id}()", 'medium')
        elif isinstance(node.func, ast.Attribute):
            if node.func.attr in DANGEROUS_FUNCTIONS:
                self._violation(node, f"禁止调用危险方法: .{node.func.attr}()", 'high')
            elif not PERMISSIVE_MODE and node.func.attr in PERMISSIVE_DANGEROUS_FUNCTIONS:
                self._violation(node, f"禁止调用方法: .{node.func.attr}()", 'medium')
            if node.func.attr in DANGEROUS_ATTRIBUTES:
                self._violation(node, f"禁止访问危险属性: .{node.func.attr}", 'high')
        self.generic_visit(node)

    def visit_Attribute(self, node):
        if node.attr in DANGEROUS_ATTRIBUTES:
            self._violation(node, f"禁止访问危险属性: .{node.attr}", 'high')
        self.generic_visit(node)

    def visit_Assign(self, node):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in DANGEROUS_FUNCTIONS:
                self._violation(node, f"禁止覆盖内置函数: {target.id}", 'medium')
        self.generic_visit(node)


def analyze_code(code):
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {
            'safe': False,
            'violations': [{
                'line': e.lineno or 0,
                'col': e.offset or 0,
                'message': f"语法错误: {e.msg}",
                'severity': 'high'
            }],
            'summary': "代码包含语法错误"
        }

    analyzer = SecurityAnalyzer()
    analyzer.visit(tree)

    if analyzer.violations:
        high = [v for v in analyzer.violations if v['severity'] == 'high']
        medium = [v for v in analyzer.violations if v['severity'] == 'medium']
        if high:
            return {
                'safe': False,
                'violations': analyzer.violations,
                'summary': f"代码包含 {len(high)} 个高危安全违规，已阻止执行"
            }
        return {
            'safe': True,
            'violations': analyzer.violations,
            'summary': f"代码包含 {len(medium)} 个中危安全警告，允许执行"
        }

    return {
        'safe': True,
        'violations': [],
        'summary': "代码安全检查通过"
    }


if __name__ == '__main__':
    code = sys.stdin.read()
    result = analyze_code(code)
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result['safe'] else 1)
