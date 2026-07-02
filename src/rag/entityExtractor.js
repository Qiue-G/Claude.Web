/**
 * 轻量 NER (命名实体识别) 提取器 — B3 多路召回
 *
 * 使用正则和关键词字典提取文本中的实体，用于实体匹配检索通道。
 * 不依赖外部 NLP 服务，完全本地运行。
 *
 * 支持的实体类型：
 * - 编程语言 (Python, JavaScript, Rust, Go, TypeScript...)
 * - 技术栈/框架 (React, Docker, PostgreSQL, Kubernetes...)
 * - 概念 (函数定义、接口、类、API...)
 * - 数字和版本号
 * - 日期
 * - URL/路径
 */

// ── 编程语言字典 ──
const LANGUAGES = new Set([
  'python', 'javascript', 'typescript', 'rust', 'go', 'java', 'c++', 'c#', 'c',
  'ruby', 'php', 'swift', 'kotlin', 'scala', 'perl', 'lua', 'r', 'dart',
  'elixir', 'haskell', 'clojure', 'erlang', 'f#', 'fortran', 'cobol', 'bash',
  'shell', 'powershell', 'sql', 'graphql', 'html', 'css', 'sass', 'less',
  'yaml', 'json', 'xml', 'toml', 'markdown',
]);

// ── 技术栈/框架字典 ──
const TECHNOLOGIES = new Set([
  'react', 'vue', 'angular', 'svelte', 'next.js', 'nuxt', 'express', 'django',
  'flask', 'fastapi', 'spring', 'spring boot', 'asp.net', 'rails', 'laravel',
  'symfony', 'tensorflow', 'pytorch', 'keras', 'docker', 'kubernetes', 'k8s',
  'nginx', 'apache', 'redis', 'memcached', 'mysql', 'postgresql', 'mongodb',
  'sqlite', 'elasticsearch', 'kafka', 'rabbitmq', 'websocket', 'graphql',
  'rest', 'grpc', 'node.js', 'deno', 'bun', 'electron', 'tauri', 'flutter',
  'react native', 'webassembly', 'wasm', 'webpack', 'vite', 'rollup', 'esbuild',
  'babel', 'typescript', 'jest', 'mocha', 'cypress', 'playwright', 'selenium',
  'prometheus', 'grafana', 'datadog', 'sentry', 'logstash', 'filebeat',
  'git', 'github', 'gitlab', 'circleci', 'github actions', 'jenkins',
  'aws', 'azure', 'gcp', 'alibaba cloud', 'cloudflare', 'vercel', 'netlify',
  'terraform', 'ansible', 'pulumi', 'helm',
]);

// ── 概念/关键词 ──
const CONCEPTS = new Set([
  '函数定义', '函数声明', '接口', '类', '抽象类', '枚举', '结构体', 'trait',
  '类型定义', '泛型', '回调', '闭包', '异步', 'await', 'promise',
  '依赖注入', '控制反转', '工厂模式', '单例', '观察者', '发布订阅',
  '中间件', '路由', '控制器', '服务', '仓储', '适配器', '代理',
  '缓存', '会话', '认证', '授权', '加密', '哈希', '签名',
  '事务', '索引', '视图', '存储过程', '触发器', '迁移', '种子',
  '测试', '单元测试', '集成测试', 'e2e测试', 'mock', 'stub',
  '部署', 'ci/cd', '监控', '日志', '告警', '追踪',
]);

// ── 正则实体提取 ──
const PATTERNS = [
  // 版本号: v1.2.3, 1.2.3, v2024
  { type: 'version', regex: /\bv?(\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.]+)?)\b/gi },
  // URL
  { type: 'url', regex: /https?:\/\/[^\s<>"']+/gi },
  // 文件路径: /path/to/file, C:\path\to\file
  { type: 'path', regex: /(?:[a-zA-Z]:\\[^\s<>"']+|\/[^\s<>"']+\/[^\s<>"']+)/g },
  // 日期: 2024-01-15, 2024/01/15
  { type: 'date', regex: /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g },
];

/**
 * 从文本中提取实体
 * @param {string} text
 * @returns {{ type: string, value: string }[]}
 */
export function extractEntities(text) {
  if (!text) return [];
  const entities = [];
  const seen = new Set();

  const lower = text.toLowerCase();
  const words = lower.split(/[\s,.;:!?()\[\]{}"'<>/\\]+/).filter(Boolean);

  // 编程语言匹配
  for (const word of words) {
    if (LANGUAGES.has(word) && !seen.has(`lang:${word}`)) {
      seen.add(`lang:${word}`);
      entities.push({ type: 'language', value: word });
    }
  }

  // 技术栈匹配（多词需要特殊处理）
  for (const tech of TECHNOLOGIES) {
    if (lower.includes(tech) && !seen.has(`tech:${tech}`)) {
      seen.add(`tech:${tech}`);
      entities.push({ type: 'technology', value: tech });
    }
  }

  // 概念匹配
  for (const concept of CONCEPTS) {
    if (lower.includes(concept) && !seen.has(`concept:${concept}`)) {
      seen.add(`concept:${concept}`);
      entities.push({ type: 'concept', value: concept });
    }
  }

  // 正则实体
  for (const { type, regex } of PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const value = match[1] || match[0];
      const key = `${type}:${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({ type, value: value.toLowerCase() });
      }
    }
  }

  return entities;
}

/**
 * 实体匹配检索 — 根据实体类型和值在文档集中查找
 *
 * @param {Array<{ text: string, metadata: object, hash: string }>} docs
 * @param {{ type: string, value: string }[]} queryEntities
 * @returns {Array<{ text: string, metadata: object, hash: string, score: number, matchedEntity: string }>}
 */
export function entityMatchSearch(docs, queryEntities) {
  if (!docs || docs.length === 0 || !queryEntities || queryEntities.length === 0) return [];

  const results = [];

  for (const doc of docs) {
    const lowerText = doc.text.toLowerCase();
    let matchScore = 0;
    const matched = [];

    for (const entity of queryEntities) {
      // 精确匹配实体值
      if (lowerText.includes(entity.value)) {
        matchScore += 1;
        matched.push(entity.value);
        continue;
      }

      // 概念宽匹配（同义词）
      if (entity.type === 'concept') {
        for (const synonym of getSynonyms(entity.value)) {
          if (lowerText.includes(synonym)) {
            matchScore += 0.5;
            matched.push(synonym);
            break;
          }
        }
      }
    }

    if (matchScore > 0) {
      results.push({
        ...doc,
        score: matchScore / queryEntities.length,
        matchedEntity: matched.join(', '),
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * 获取概念的同义词
 */
function getSynonyms(concept) {
  const synonymMap = {
    '函数定义': ['function', 'def ', 'fn ', 'func'],
    '接口': ['interface', 'api', 'contract'],
    '类': ['class', 'struct'],
    '异步': ['async', 'await', 'callback', 'promise'],
    '缓存': ['cache', 'caching', 'memcache'],
    '认证': ['auth', 'authentication', 'login', 'oauth', 'jwt'],
    '授权': ['authorization', 'permission', 'role', 'acl'],
    '部署': ['deploy', 'deployment', 'release', 'publish'],
    '监控': ['monitoring', 'monitor', 'metrics', 'observability'],
    '测试': ['test', 'testing', 'unit test', 'spec'],
    '数据库': ['database', 'db', 'sql', 'nosql', 'datastore'],
  };
  return synonymMap[concept] || [];
}
