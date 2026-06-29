/**
 * Swagger/OpenAPI 文档配置
 * 访问 /api/docs 查看 Swagger UI
 */
import { createRequire } from 'module';
import { Router } from 'express';
import { join } from 'path';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const swaggerDistPath = require('swagger-ui-dist').getAbsoluteFSPath();

// ============================================================
// OpenAPI 规范定义
// ============================================================
const SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'Claude.Web API',
    version: '7.3.2',
    description: `
Claude.Web 是一个基于 free-code CLI 的 Web 界面，提供 AI 聊天、文件管理、知识库(RAG)、
搜索、代码执行等功能的 REST API。

## 认证
- **Session Token**: 在 Header 中通过 \`x-session-token\` 传递
- **CSRF Token**: 写操作需要通过 \`x-csrf-token\` Header 传递
- **Session ID**: 通过 \`x-session-id\` Header 或在请求体中传递
    `.trim(),
    contact: { name: 'Claude.Web' },
  },
  servers: [
    { url: '/', description: '本地/部署服务器' },
  ],
  paths: {
    // ======================== Session ========================
    '/api/session': {
      post: {
        tags: ['Session'],
        summary: '创建新会话',
        description: '使用 API Key 创建聊天会话，返回 sessionId 和凭证',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['apiKey'],
                properties: {
                  apiKey: { type: 'string', description: 'AI 提供商的 API Key', maxLength: 200 },
                  model: { type: 'string', description: '模型 ID（可选，默认使用服务端配置）', example: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
                  provider: { type: 'string', enum: ['openrouter', 'anthropic', 'openai', 'deepseek'], description: '提供商（可选）' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: '成功创建会话',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string', format: 'uuid', description: '会话 ID' },
                    token: { type: 'string', description: '会话 Token' },
                    csrfToken: { type: 'string', description: 'CSRF 保护 Token' },
                  },
                },
              },
            },
          },
          400: { description: '参数错误（API Key 无效等）' },
          429: { description: '请求频率超限' },
          503: { description: '会话数已达上限' },
        },
      },
    },
    '/api/session/current': {
      get: {
        tags: ['Session'],
        summary: '验证当前会话凭证',
        description: '用于页面刷新后自动重连，验证 localStorage 中的凭证是否有效',
        parameters: [
          { in: 'header', name: 'x-session-id', required: true, schema: { type: 'string' }, description: '会话 ID' },
          { in: 'header', name: 'x-session-token', required: true, schema: { type: 'string' }, description: '会话 Token' },
        ],
        responses: {
          200: {
            description: '凭证有效',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string' },
                    model: { type: 'string' },
                    provider: { type: 'string' },
                    currentModel: { type: 'string' },
                  },
                },
              },
            },
          },
          400: { description: '缺少凭证' },
          401: { description: '会话或 Token 无效' },
        },
      },
    },
    '/api/session/{id}': {
      get: {
        tags: ['Session'],
        summary: '获取会话信息',
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: '会话 ID' },
          { in: 'header', name: 'x-session-token', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: '会话信息', content: { 'application/json': { schema: { type: 'object', properties: { sessionId: { type: 'string' }, model: { type: 'string' }, provider: { type: 'string' } } } } } },
          401: { description: 'Token 无效' },
        },
      },
      delete: {
        tags: ['Session'],
        summary: '删除会话',
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-session-token', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-csrf-token', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: '删除成功', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          403: { description: 'CSRF Token 无效' },
        },
      },
    },

    // ======================== Models ========================
    '/api/models': {
      get: {
        tags: ['Models'],
        summary: '获取模型列表',
        description: '获取默认提供商的可用模型列表。可通过 ?provider= 参数指定提供商',
        parameters: [
          { in: 'query', name: 'provider', schema: { type: 'string' }, description: '提供商名称，如 openrouter、deepseek、anthropic、openai' },
        ],
        responses: {
          200: {
            description: '模型列表',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    provider: { type: 'string' },
                    models: { type: 'array', items: { $ref: '#/components/schemas/Model' } },
                    fallback: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/models/{provider}': {
      get: {
        tags: ['Models'],
        summary: '获取指定提供商的模型列表',
        parameters: [
          { in: 'path', name: 'provider', required: true, schema: { type: 'string' }, description: '提供商名称' },
        ],
        responses: {
          200: { description: '模型列表' },
          404: { description: '未知提供商' },
        },
      },
    },

    // ======================== Health ========================
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: '服务器健康检查',
        responses: {
          200: {
            description: '服务器状态',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['ok'] },
                    version: { type: 'string' },
                    sessions: { type: 'integer' },
                    maxSessions: { type: 'integer' },
                    uptime: { type: 'number', description: '运行秒数' },
                    memory: {
                      type: 'object',
                      properties: {
                        heapUsedMB: { type: 'integer' },
                        heapTotalMB: { type: 'integer' },
                        rssMB: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/health/detailed': {
      get: {
        tags: ['Health'],
        summary: '详细健康检查',
        description: '包含模型统计、活跃会话列表、限流状态',
        responses: {
          200: { description: '详细信息' },
        },
      },
    },

    // ======================== Config & Tools ========================
    '/api/config': {
      get: {
        tags: ['Config'],
        summary: '获取服务器配置',
        description: '返回版本号、默认提供商/模型、已配置的 AI 提供商列表',
        responses: {
          200: {
            description: '服务器配置',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    version: { type: 'string' },
                    defaults: {
                      type: 'object',
                      properties: {
                        provider: { type: 'string' },
                        model: { type: 'string' },
                      },
                    },
                    providers: {
                      type: 'object',
                      additionalProperties: {
                        type: 'object',
                        properties: {
                          baseUrl: { type: 'string', nullable: true },
                          fallbackModel: { type: 'string', nullable: true },
                          modelCount: { type: 'integer' },
                          aliasCount: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/tools': {
      get: {
        tags: ['Config'],
        summary: '获取可用的工具定义',
        description: '返回内置工具（Web Search、Code Interpreter 等）+ MCP 工具列表',
        responses: {
          200: {
            description: '工具列表',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tools: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          label: { type: 'string' },
                          description: { type: 'string' },
                          icon: { type: 'string' },
                          configured: { type: 'boolean' },
                          unavailableReason: { type: 'string', nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/config/mcp': {
      get: {
        tags: ['Config'],
        summary: '查看 MCP 服务器状态',
        responses: {
          200: {
            description: 'MCP 服务器列表',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    servers: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          connected: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ======================== Search ========================
    '/api/search': {
      get: {
        tags: ['Search'],
        summary: '全文本搜索',
        description: '搜索对话和消息内容，按会话分组返回结果',
        parameters: [
          { in: 'query', name: 'q', required: true, schema: { type: 'string' }, description: '搜索关键词' },
        ],
        responses: {
          200: {
            description: '搜索结果',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          sessionId: { type: 'string' },
                          title: { type: 'string' },
                          snippet: { type: 'string' },
                          messageRole: { type: 'string' },
                          timestamp: { type: 'integer' },
                        },
                      },
                    },
                    total: { type: 'integer' },
                    query: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ======================== Files ========================
    '/api/files/{sessionId}': {
      get: {
        tags: ['Files'],
        summary: '获取文件树',
        description: '获取会话工作目录的完整文件树',
        parameters: [
          { in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-session-token', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: '文件树（递归结构）' },
          401: { description: 'Session 无效' },
        },
      },
    },
    '/api/files/{sessionId}/versions/{path}': {
      get: {
        tags: ['Files', 'Version'],
        summary: '获取文件版本历史',
        parameters: [
          { in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'path', required: true, schema: { type: 'string' }, description: '文件路径' },
          { in: 'header', name: 'x-session-token', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: '版本列表',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    versions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          filePath: { type: 'string' },
                          hash: { type: 'string' },
                          size: { type: 'integer' },
                          createdAt: { type: 'integer' },
                          action: { type: 'string', enum: ['save', 'delete', 'rollback', 'rollback-save'] },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/files/{sessionId}/version/{versionId}/{path}': {
      get: {
        tags: ['Files', 'Version'],
        summary: '读取特定版本的文件内容',
        parameters: [
          { in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'versionId', required: true, schema: { type: 'string', format: 'uuid' } },
          { in: 'path', name: 'path', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-session-token', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: '文件内容' },
          404: { description: '版本不存在' },
        },
      },
    },
    '/api/files/{sessionId}/diff/{fromId}/{toId}': {
      get: {
        tags: ['Files', 'Version'],
        summary: '对比两个版本的差异',
        parameters: [
          { in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'fromId', required: true, schema: { type: 'string', format: 'uuid' }, description: '源版本 ID' },
          { in: 'path', name: 'toId', required: true, schema: { type: 'string', format: 'uuid' }, description: '目标版本 ID' },
          { in: 'header', name: 'x-session-token', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Diff 结果（行级变更）',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    fromTime: { type: 'integer' },
                    toTime: { type: 'integer' },
                    changes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          value: { type: 'string' },
                          added: { type: 'boolean' },
                          removed: { type: 'boolean' },
                          count: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/files/{sessionId}/rollback/{versionId}/{path}': {
      post: {
        tags: ['Files', 'Version'],
        summary: '回滚文件到指定版本',
        description: '将文件内容回滚到历史版本，当前内容会先保存为一个版本',
        parameters: [
          { in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'versionId', required: true, schema: { type: 'string', format: 'uuid' } },
          { in: 'path', name: 'path', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-session-token', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-csrf-token', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: '回滚成功' },
          403: { description: 'CSRF Token 无效' },
          404: { description: '版本或文件不存在' },
        },
      },
    },
    '/api/files/{sessionId}/{path}': {
      get: {
        tags: ['Files'],
        summary: '读取文件内容',
        parameters: [
          { in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'path', required: true, schema: { type: 'string' }, description: '文件路径' },
          { in: 'header', name: 'x-session-token', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: '文件内容（纯文本）' },
          403: { description: '路径越权' },
          404: { description: '文件不存在' },
        },
      },
      post: {
        tags: ['Files'],
        summary: '写入/创建文件',
        description: '写入文件内容，自动保存旧版本到版本历史',
        parameters: [
          { in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'path', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-session-token', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-csrf-token', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: {
                  content: { type: 'string', description: '文件内容' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '写入成功' },
          403: { description: '路径越权或 CSRF 无效' },
        },
      },
      delete: {
        tags: ['Files'],
        summary: '删除文件',
        parameters: [
          { in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'path', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-session-token', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-csrf-token', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: '删除成功' },
          403: { description: '越权或 CSRF 无效' },
        },
      },
    },

    // ======================== RAG ========================
    '/api/rag/status': {
      get: {
        tags: ['RAG'],
        summary: '获取 RAG 系统状态',
        responses: {
          200: { description: 'RAG 系统信息' },
        },
      },
    },
    '/api/rag/collections': {
      get: {
        tags: ['RAG'],
        summary: '列出所有集合',
        responses: {
          200: { description: '集合列表' },
        },
      },
    },
    '/api/rag/ingest': {
      post: {
        tags: ['RAG'],
        summary: '上传文档到知识库',
        description: '支持文本模式和 base64 文件模式',
        parameters: [
          { in: 'header', name: 'x-session-id', schema: { type: 'string' } },
          { in: 'header', name: 'x-session-token', schema: { type: 'string' } },
          { in: 'header', name: 'x-csrf-token', schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  sessionId: { type: 'string' },
                  text: { type: 'string', description: '文本内容（文本模式）' },
                  collection: { type: 'string', description: '集合名称（默认 default）' },
                  metadata: { type: 'object' },
                  file: { type: 'string', description: 'Base64 编码的文件内容（文件模式）' },
                  filename: { type: 'string', description: '文件名' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '摄入结果' },
          401: { description: 'Session 无效' },
          403: { description: 'CSRF Token 无效' },
        },
      },
    },
    '/api/rag/ingest/url': {
      post: {
        tags: ['RAG'],
        summary: '从 URL 摄入文档',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url'],
                properties: {
                  sessionId: { type: 'string' },
                  url: { type: 'string', format: 'uri' },
                  collection: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '摄入结果' },
        },
      },
    },
    '/api/rag/ingest/rest': {
      post: {
        tags: ['RAG'],
        summary: '从 REST API 摄入数据',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url'],
                properties: {
                  sessionId: { type: 'string' },
                  url: { type: 'string', format: 'uri' },
                  method: { type: 'string', enum: ['GET', 'POST'], default: 'GET' },
                  headers: { type: 'object' },
                  body: { type: 'string' },
                  collection: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '摄入结果' },
        },
      },
    },
    '/api/rag/search': {
      post: {
        tags: ['RAG'],
        summary: '搜索知识库',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  sessionId: { type: 'string' },
                  query: { type: 'string', description: '搜索关键词' },
                  collection: { type: 'string', description: '集合名称' },
                  limit: { type: 'integer', default: 10 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: '搜索结果',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          text: { type: 'string' },
                          score: { type: 'number' },
                          metadata: { type: 'object' },
                        },
                      },
                    },
                    query: { type: 'string' },
                    collection: { type: 'string' },
                    took: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/rag/collection/{name}': {
      delete: {
        tags: ['RAG'],
        summary: '删除指定集合',
        parameters: [
          { in: 'path', name: 'name', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-session-id', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-session-token', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'x-csrf-token', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: '删除成功' },
          401: { description: 'Session 无效' },
        },
      },
    },
  },

  components: {
    schemas: {
      Model: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
          name: { type: 'string', example: 'NVIDIA Nemotron 550B' },
          tier: { type: 'string', enum: ['free', 'paid'] },
          context: { type: 'integer', example: 128000 },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          code: { type: 'integer' },
          details: { type: 'object' },
        },
      },
    },
  },

  tags: [
    { name: 'Session', description: '会话管理（创建/验证/删除）' },
    { name: 'Models', description: 'AI 模型发现' },
    { name: 'Health', description: '服务器健康检查' },
    { name: 'Config', description: '服务器配置与工具定义' },
    { name: 'Search', description: '全文本搜索' },
    { name: 'Files', description: '文件 CRUD 与文件树' },
    { name: 'Version', description: '文件版本管理（历史/对比/回滚）' },
    { name: 'RAG', description: '知识库（RAG）管理' },
  ],
};

// ============================================================
// Express Router — 提供 Swagger UI 页面 + spec JSON
// ============================================================
export function createSwaggerRouter() {
  const router = Router();

  // 提供 swagger-ui-dist 静态资源
  router.use('/docs', (req, res, next) => {
    // 如果是 /api/docs/spec 则跳过静态文件处理
    if (req.path === '/spec') return next();
    // 否则从 swagger-ui-dist 目录提供静态文件
    expressStatic(req, res, next);
  });

  // Swagger UI 入口页面
  router.get('/docs', (req, res) => {
    const html = readFileSync(join(swaggerDistPath, 'index.html'), 'utf-8')
      .replace(/https?:\/\/petstore\.swagger\.io\/v2\/swagger\.json/g, './spec')
      .replace(/Swagger UI<\/title>/, 'Claude.Web API 文档</title>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  // 提供 OpenAPI spec JSON
  router.get('/docs/spec', (req, res) => {
    res.json(SPEC);
  });

  return router;
}

// Express static middleware bound to swagger-ui-dist path
function expressStatic(req, res, next) {
  const filePath = join(swaggerDistPath, req.path === '/docs' ? 'index.html' : req.path.replace(/^\/api\/docs\//, ''));
  try {
    const content = readFileSync(filePath);
    const ext = filePath.split('.').pop();
    const mime = {
      html: 'text/html',
      js: 'application/javascript',
      css: 'text/css',
      json: 'application/json',
      png: 'image/png',
      svg: 'image/svg+xml',
      map: 'application/json',
    };
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
    res.send(content);
  } catch {
    next();
  }
}
