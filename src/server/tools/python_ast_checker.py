"""
Python AST 安全分析脚本
从 stdin 读取代码，输出 JSON 分析结果
用于代码解释器执行前的安全验证（第一层防护）
"""
import ast
import sys
import json


# 禁止导入的模块
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

# 禁止的函数调用
DANGEROUS_FUNCTIONS = {
    'open', 'exec', 'eval', 'compile', 'input',
    '__import__', 'globals', 'locals', 'vars',
    'breakpoint', 'exit', 'quit',
    # 反射函数（可动态访问危险属性和模块）
    'getattr', 'setattr', 'delattr',
}

# 禁止的属性访问
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
        for alias in node.names:
            name = alias.name
            if name in DANGEROUS_IMPORTS:
                self._violation(node, f"禁止导入危险模块: {name}", 'high')
            elif name not in SAFE_IMPORTS and not name.startswith('.'):
                self._violation(node, f"未授权导入模块: {name}", 'medium')
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        module = node.module or ''
        if module in DANGEROUS_IMPORTS:
            self._violation(node, f"禁止从危险模块导入: {module}", 'high')
        elif module not in SAFE_IMPORTS and not module.startswith('.'):
            self._violation(node, f"未授权从模块导入: {module}", 'medium')
        for alias in node.names:
            if alias.name in DANGEROUS_FUNCTIONS:
                self._violation(node, f"禁止导入危险函数: {alias.name}", 'high')
        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name):
            if node.func.id in DANGEROUS_FUNCTIONS:
                self._violation(node, f"禁止调用危险函数: {node.func.id}()", 'high')
        elif isinstance(node.func, ast.Attribute):
            if node.func.attr in DANGEROUS_FUNCTIONS:
                self._violation(node, f"禁止调用危险方法: .{node.func.attr}()", 'high')
            if node.func.attr in DANGEROUS_ATTRIBUTES:
                self._violation(node, f"禁止访问危险属性: .{node.func.attr}", 'high')
        self.generic_visit(node)

    def visit_Attribute(self, node):
        if node.attr in DANGEROUS_ATTRIBUTES:
            self._violation(node, f"禁止访问危险属性: .{node.attr}", 'high')
        self.generic_visit(node)

    def visit_With(self, node):
        for item in node.items:
            ctx = item.context_expr
            if isinstance(ctx, ast.Call) and isinstance(ctx.func, ast.Name):
                if ctx.func.id == 'open':
                    self._violation(node, "禁止使用 open() 进行文件操作", 'high')
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
