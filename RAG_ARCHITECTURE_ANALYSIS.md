# RAG 知识库架构深度分析报告

> 分析对象：[open-webui](https://github.com/Qiue-G/open-webui) (main) · [Kun](https://github.com/Qiue-G/Kun) (master)
> 分析手段：GitHub API 目录遍历 + 源码直读，**未克隆仓库**
> 目标：逐方面深入分解 → 交叉对比 → 提炼可移植实践 → 输出 Claude.Web 融合方案

---

# 第一部分：Open WebUI 深度分析

## 1.1 内容摄取层（Loaders）

### 1.1.1 Loader 引擎架构

`retrieval/loaders/main.py` 中的 `Loader` 类是内容摄取的统一入口。它采用 **策略模式**：根据 `self.engine` 配置分发到不同的后端解析引擎。

**核心接口：**
```python
class Loader:
    def __init__(self, engine: str = '', **kwargs):
        self.engine = engine        # 引擎选择：tika | docling | datalab_marker | mistral | paddleocr_vl | mineru | external
        self.kwargs = kwargs        # 所有引擎的配置参数

    def load(self, filename, file_content_type, file_path) -> list[Document]:
        loader = self._get_loader(filename, file_content_type, file_path)
        docs = loader.load()
        # 统一做 ftfy 编码修复，捕获莫吉贝克（mojibake）乱码
        return [Document(page_content=ftfy.fix_text(doc.page_content), metadata=doc.metadata) for doc in docs]

    async def aload(self, filename, file_content_type, file_path) -> list[Document]:
        # 异步版本：通过 asyncio.to_thread 将同步 load 卸载到线程池
        return await asyncio.to_thread(self.load, filename, file_content_type, file_path)
```

**引擎分发逻辑（`_get_loader` 方法）：** 按优先级排列：

1. **External** (`engine == 'external'`)：如果配置了 `EXTERNAL_DOCUMENT_LOADER_URL` 和 `EXTERNAL_DOCUMENT_LOADER_API_KEY`，使用外部文档解析服务。这是最高优先级，让用户可以接入自建的解析微服务。

2. **Datalab Marker** (`engine == 'datalab_marker'`)：当配置了 API key 且文件扩展名为 PDF/XLS/DOCX/PPTX/HTML/EPUB/PNG/JPEG 等 23 种格式时使用。通过 HTTP API 调用 datalab.to 服务进行 OCR + Markdown 提取。

3. **Docling** (`engine == 'docling'`)：使用 IBM Docling 服务的 HTTP API，POST 文件到 `/v1/convert/file`，返回 `md_content`。

4. **MinerU** (`engine == 'mineru'`)：通过配置的 MinerU API URL，支持 PDF/Office/图片等多种格式，可配置 OCR 和布局分析参数。

5. **Mistral OCR** (`engine == 'mistral'`)：使用 Mistral AI 的 OCR API，一个 29KB 的独立解析器，适合高精度文档 OCR。

6. **PaddleOCR-VL** (`engine == 'paddleocr_vl'`)：基于视觉语言模型的 OCR，配置 `BASE_URL` + `TOKEN` 即可使用。

7. **Tika** (`engine == 'tika'`)：Apache Tika 服务器，PUT 文件到 `/tika/text` 端点提取文本和元数据。

8. **默认 Fallback**：使用 LangChain 内置的文档加载器（PyPDFLoader、Docx2txtLoader、CSVLoader、BSHTMLLoader 等）。

### 1.1.2 文本文件编码检测（CJK 特殊处理）

`_detect_text_encoding()` 是 Open WebUI 专门为 CJK（中日韩）文本文件设计的编码检测系统，包含四条防线：

```
第1层：UTF-8 快速路径
  raw.decode('utf-8') → 成功即返回 'utf-8'
  覆盖全球 90%+ 的现代文本文件

第2层：chardet 检测 + CJK 家族映射
  chardet 经常误报（如 GB2312 → 实际是 GB18030）
  _ENC_FAMILY 映射表：
    {'gb2312': 'gb18030', 'gbk': 'gb18030', 'big5': 'big5',
     'euckr': 'euc-kr', 'eucjp': 'euc-jp', 'shiftjis': 'shift_jis'}
  chardet 提示 → 映射到正确 superset → 优先级队列

第3层：CJK 字符比例验证
  _has_cjk_characters(text, threshold=0.05)
  检查解码文本中 CJK 区块（CJK统一表意文字 0x4E00-0x9FFF、
  扩展A区 0x3400-0x4DBF、假名、谚文等）字符占比 ≥ 5%
  防御：解码"成功"但产生乱码字符的假阳性

第4层：latin-1 终极 Fallback
  latin-1 接受所有 0x00-0xFF 字节，不会抛异常
  后续 ftfy.fix_text() 修复莫吉贝克乱码
```

### 1.1.3 Web 内容提取

`get_content_from_url()` 函数处理网络内容抓取，实现了一个安全的分叉逻辑：

```
输入 URL
  │
  ▼
validate_url() → 验证协议、阻止私有 IP、域名黑名单
  │
  ├── YouTube URL → YoutubeLoader(transcript API)
  │                   不使用 HTTP response body，避免短链接 303 问题
  │
  └── 非 YouTube URL
        │
        ▼
      requests.get(stream=True, allow_redirects=False) ← 防 SSRF：不跟随重定向
        │
        ├── 文本/HTML/XML/JSON → BSHTMLLoader（网页解析器）
        │
        └── 二进制 (PDF/DOCX/XLSX/PPTX)
              │
              ▼
            _extract_text_from_binary_response()
              ├── 下载到临时文件
              ├── 通过 Loader 引擎解析
              └── 清理临时文件
```

**安全设计要点：**
- `validate_url()` 在重定向前验证初始 URL，阻止 SSRF 攻击
- `allow_redirects=False` 防止攻击者在公共 URL 后接私有 IP 重定向
- `stream=True` 仅在探测 Content-Type 时流式读取，不下载完整 body
- YouTube 有独立路径，避免短链接 `youtu.be` 的 303 重定向被误判为二进制内容

### 1.1.4 支持的文件格式

`known_source_ext` 数组列了 50+ 个源码文件扩展名：`go, py, java, sh, bat, ps1, cmd, js, ts, css, cpp, hpp, h, c, cs, sql, log, ini, pl, pm, r, dart, dockerfile, env, php, hs, hsc, lua, nginxconf, conf, m, mm, plsql, perl, rb, rs, db2, scala, bash, swift, vue, svelte, ex, exs, erl, tsx, jsx, hs, lhs, json, yaml, yml, toml` + 所有主流文档格式（PDF, DOCX, XLSX, PPTX, HTML, EPUB, 图片等）。

## 1.2 向量存储层

### 1.2.1 抽象接口体系

三层架构设计实现完美的关注点分离：

**第1层：抽象基类 `VectorDBBase`**（`retrieval/vector/main.py`）

```python
class VectorDBBase(ABC):
    has_collection(collection_name) → bool                # 集合存在性检查
    delete_collection(collection_name) → None               # 删除集合
    insert(collection_name, items: List[VectorItem]) → None # 批量插入
    upsert(collection_name, items: List[VectorItem]) → None # 插入或更新
    search(collection_name, vectors, filter, limit)         # 向量相似性搜索
        → Optional[SearchResult]                            #  含 ids/documents/metadatas/distances
    query(collection_name, filter, limit)                   # 元数据过滤查询
        → Optional[GetResult]
    get(collection_name) → Optional[GetResult]              # 全量获取
    delete(collection_name, ids, filter) → None             # 按 ID 或条件删除
    reset() → None                                          # 全量重置

# 数据模型
class VectorItem(BaseModel):
    id: str
    text: str                               # 原始文本
    vector: List[float | int]               # 嵌入向量
    metadata: Any                           # 任意元数据（文件名/时间/来源等）

class SearchResult(GetResult):
    distances: Optional[List[List[float | int]]]  # 距离分数（0=最远, 1=最近）
```

**第2层：工厂模式 `factory.py`**

根据 `VECTOR_DB` 环境变量自动实例化对应后端：
```python
# 顶层全局单例
VECTOR_DB_CLIENT: VectorDBBase = {
    'chroma': ChromaClient(),
    'pgvector': PGVectorClient(),
    'qdrant': QdrantClient(),
    'milvus': MilvusClient(),
    'elasticsearch': ElasticsearchClient(),
    'opensearch': OpenSearchClient(),
    'pinecone': PineconeClient(),
    'weaviate': WeaviateClient(),
    's3': S3VectorClient(),
    'valkey': ValkeyClient(),
    'mariadb': MariaDBVectorClient(),
    'oracle': Oracle23aiClient(),
    'opengauss': OpenGaussClient(),
}[VECTOR_DB]
```

**第3层：异步包装器 `AsyncVectorDBClient`**（`retrieval/vector/async_client.py`）

关键是 `asyncio.to_thread` 的使用——每个向量库方法被自动包装在工作线程中执行，避免阻塞事件循环：

```python
class AsyncVectorDBClient:
    def __init__(self, sync_client):
        self._sync = sync_client  # 逃逸舱口：绕过异步层直接调用同步方法

    async def search(self, collection_name, vectors, filter=None, limit=10):
        return await asyncio.to_thread(
            self._sync.search, collection_name, vectors, filter, limit
        )
    # 其他方法同理...

ASYNC_VECTOR_DB_CLIENT = AsyncVectorDBClient(VECTOR_DB_CLIENT)
```

### 1.2.2 Chroma 适配器实现深度解析（`chroma.py`）

Chroma 是默认向量库，实现展示了完整的适配模式：

**初始化分支：**
```python
if CHROMA_HTTP_HOST != '':
    # 客户端-服务端模式（远程部署）
    self.client = chromadb.HttpClient(host, port, headers, ssl, tenant, database, settings)
else:
    # 嵌入式 PersistentClient（本地单机）
    self.client = chromadb.PersistentClient(path=CHROMA_DATA_PATH, settings)
```

**搜索实现——距离归一化：**
```python
result = collection.query(query_embeddings=vectors, n_results=limit, where=filter)
# Chroma 返回余弦距离：0（最相似）→ 2（最不相似）
# 需要归一化为 0（最不相似）→ 1（最相似）
distances = result['distances'][0]
distances = [2 - dist for dist in distances]       # 反转方向
distances = [[dist / 2 for dist in distances]]     # 归一化到 [0, 1]
```

**批量插入：**
```python
for batch in create_batches(api=self.client, documents=documents,
                            embeddings=embeddings, ids=ids, metadatas=metadatas):
    collection.add(*batch)  # 分批添加，防止单批次过大 OOM
```

**删除的健壮性：**
```python
def delete(self, collection_name, ids=None, filter=None):
    try:
        collection = self.client.get_collection(name=collection_name)
        if collection:
            if ids: collection.delete(ids=ids)
            elif filter: collection.delete(where=filter)
    except Exception:
        pass  # 集合不存在时静默忽略，幂等删除
```

### 1.2.3 全部 14 个后端适配器总览

| 后端 | 文件大小 | 部署方式 | 关键特征 |
|---|---|---|---|
| Chroma | 7KB | 客户端/嵌入式 | 默认，零配置，HNSW 索引 |
| PGVector | 28KB | PostgreSQL 扩展 | 事务 ACID，与业务数据共存 |
| Qdrant | 9KB | 独立服务 | 高性能过滤，payload 索引 |
| Qdrant Multi-tenancy | 14KB | 独立服务 | 按 tenant 隔离的集合策略 |
| Milvus | 15KB | 分布式集群 | 百亿级向量规模 |
| Milvus Multi-tenancy | 12KB | 分布式集群 | 多租户资源隔离 |
| Elasticsearch | 10KB | 独立服务 | 全文 + 向量混合查询 |
| OpenSearch | 9KB | 独立服务 | AWS 兼容，k-NN 插件 |
| Pinecone | 21KB | 云托管 SaaS | Serverless，无运维 |
| Weaviate | 12KB | 独立服务 | GraphQL 接口，多模态 |
| S3Vector | 30KB | 对象存储 | 成本极低，适合归档 |
| Valkey | 32KB | Redis 兼容 | 极低延迟，内存级 |
| MariaDB | 22KB | 关系型数据库 | 复用已有 MySQL 生态 |
| Oracle 23ai | 33KB | 企业级 | AI Vector Search 新特性 |

## 1.3 检索层

### 1.3.1 混合搜索流水线

Open WebUI 的检索系统在 `retrieval/utils.py`（60KB，整个系统最大的文件）中实现了一条 4 阶段流水线：

```
用户查询
  │
  ▼
[阶段1] BM25 关键词检索
  │   BM25Retriever.from_texts(texts, metadatas)
  │   texts = get_enriched_texts()  ← 文件名/标题/章节注入
  │   k = top_k
  │
  ▼
[阶段2] 向量相似性检索
  │   VectorSearchRetriever(collection_name, embedding_function, top_k)
  │   embedding_function(query, RAG_EMBEDDING_QUERY_PREFIX)
  │   ASYNC_VECTOR_DB_CLIENT.search(collection_name, vectors=[embedding], limit=top_k)
  │   CHUNK_HASH_KEY = sha256(文档内容)  → 用于后续去重
  │
  ▼
[阶段3] Ensemble RRF 融合
  │   EnsembleRetriever(
  │     retrievers=[bm25_retriever, vector_search_retriever],
  │     weights=[hybrid_bm25_weight, 1.0 - hybrid_bm25_weight],
  │     id_key='_chunk_hash'  ← 关键：通过内容 hash 去重
  │   )
  │   hybrid_bm25_weight = 0 → 纯向量搜索
  │                          1 → 纯 BM25 搜索
  │                        0.5 → 均衡
  │
  ▼
[阶段4] 重排序压缩
  │   ContextualCompressionRetriever(
  │     base_compressor=RerankCompressor(embedding_function, top_n, reranking_function),
  │     base_retriever=ensemble_retriever
  │   )
  │   RerankCompressor：对初步结果二次排序
  │   reranking_function：可接入交叉编码器模型
  │
  ▼
最终结果
```

### 1.3.2 BM25 内容富化机制

```python
def get_enriched_texts(collection_result) -> list[str]:
    enriched_texts = []
    for idx, text in enumerate(collection_result.documents[0]):
        metadata = collection_result.metadatas[0][idx]
        metadata_parts = [text]

        # 文件名重复两次（给 BM25 中关键词加权）
        if metadata.get('name'):
            filename = metadata['name']
            filename_tokens = filename.replace('_', ' ').replace('-', ' ').replace('.', ' ')
            metadata_parts.append(f'Filename: {filename} {filename_tokens} {filename_tokens}')

        # 文档标题
        if metadata.get('title'):
            metadata_parts.append(f'Title: {metadata["title"]}')

        # Markdown 章节层级（从分块器保留）
        if metadata.get('headings'):
            headings = ' > '.join(str(h) for h in metadata['headings'])
            metadata_parts.append(f'Section: {headings}')

        # 来源 URL/路径
        if metadata.get('source'):
            metadata_parts.append(f'Source: {metadata["source"]}')

        # 搜索引擎摘要（Web 搜索特有）
        if metadata.get('snippet'):
            metadata_parts.append(f'Snippet: {metadata["snippet"]}')

        enriched_texts.append(' '.join(metadata_parts))
    return enriched_texts
```

**设计意图**：BM25 是基于词频的检索函数。通过将元数据作为纯文本注入文档正文，BM25 的 TF-IDF 打分自然会给包含这些术语的查询更高权重。文件名重复两次是故意让文件名在 TF-IDF 中有更高的逆文档频率权重。

### 1.3.3 RRF 去重——内容哈希

```python
CHUNK_HASH_KEY = '_chunk_hash'

def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()
```

每个块在检索时会计算 SHA-256 哈希并写入 metadata。Ensemble Retriever 使用 `id_key=CHUNK_HASH_KEY` 进行 RRF（Reciprocal Rank Fusion）融合。这样做的意义：

- BM25 使用富化文本（含文件名），向量搜索使用原始文本，两者结果会有差异
- 内容哈希确保**同一文本块**无论通过哪种检索方式到达，在 RRF 中只出现一次
- 相比使用 document ID，内容哈希对同一内容的不同副本也能去重

### 1.3.4 重排序器

`RerankCompressor` 由 `reranking_function` 参数控制：

```python
compressor = RerankCompressor(
    embedding_function=embedding_function,
    top_n=k_reranker,
    reranking_function=reranking_function,  # 可接交叉编码器
    r_score=r,                              # RRF 的 r 参数
)
```

- 如果没有配置 `reranking_function`，回退到使用嵌入模型的向量相似度重排
- 如果配置了交叉编码器（如 Cohere rerank、BGE Reranker），则进行二次重排
- `r_score` 控制 RRF 融合的平滑度（通常默认 60）

## 1.4 嵌入层

Open WebUI 的嵌入系统通过以下配置管理：

```python
RAG_EMBEDDING_CONTENT_PREFIX  # 文档侧嵌入前缀（如 "search_document: "）
RAG_EMBEDDING_QUERY_PREFIX   # 查询侧嵌入前缀（如 "search_query: "）
RAG_EMBEDDING_PREFIX_FIELD_NAME  # 前缀在 metadata 中的字段名
```

**设计意图**：相同文本作为文档和查询时的语义不同。例如 `"search_document: Python 是一种编程语言"` 和 `"search_query: Python 是什么"` 在嵌入空间中应该距离更近。这种 dual-encoder 前缀方法是 Sentence Transformers 社区的最佳实践（如 BERT 的 `[CLS]` 标记 + 前缀提示）。

嵌入模型通过 HuggingFace Hub 下载，默认在首次使用时下载。离线模式可通过 `HF_HUB_OFFLINE=1` 禁用下载尝试。

---

# 第二部分：Kun 深度分析

## 2.1 缓存优先架构

### 2.1.1 ImmutablePrefix 系统

Kun 最核心的设计理念是 **缓存优先（cache-first）**。传统 RAG 每次查询都重新计算嵌入，而 Kun 的每轮模型调用都有很大一部分内容完全不变。

```
每轮模型请求的组成部分：
┌─────────────────────────────────────────────────────────┐
│  ImmutablePrefix（系统提示 + 工具定义）                 │ ← 不变
│   - Kun 运行契约（kun-system-prompt.ts）                │
│   - 工具 Schema（canonical sorted）                     │
│   - Few-shot 示例（指纹仅含可缓存字段）                 │
├─────────────────────────────────────────────────────────┤
│  动态上下文（追加在稳定前缀之后）                       │ ← 变
│   - 会话历史消息                                        │
│   - 长期记忆注入                                        │
│   - 工具调用结果                                        │
│   - 用户输入                                            │
└─────────────────────────────────────────────────────────┘
```

**指纹验证机制：**

```typescript
// 在每次 model step 前校验
function verifyImmutablePrefix(): void {
    const currentFingerprint = hash(serialize(prefix));
    if (currentFingerprint !== lastKnownFingerprint) {
        // 前缀漂移！立刻暴露给开发者
        console.warn('⚠️ ImmutablePrefix fingerprint drift detected');
        // 缓存将被绕过，但不会产生静默错误
    }
}
```

**缓存验证清单：**
- `ImmutablePrefix` 只放长期不变的运行契约（时间戳、workspace 路径、动态工具结果等一律不进入）
- Few-shot fingerprint 只计算真正发给模型的内容，排除 id、turn id、timestamp 等动态字段
- 工具 schema 在发送前 **canonical sort**（按 key 排序），避免同工具集合因顺序不同造成前缀漂移
- 每轮持久化 `tool catalog fingerprint` + `tool count`，工具定义漂移时标记 `toolCatalogDrift`

### 2.1.2 缓存性能验证

2026-06-02 真实生产数据：

```
场景1：12 轮短消息
  整体命中率（含冷启动）：94.7%
  最新一轮命中率：93.6%

场景2：同一稳定前缀 24 轮短消息
  整体命中率（含冷启动）：95.2%
  最新一轮命中率：98.1%
```

冷启动（第一轮）通常命中率为 0，因为服务端还没有缓存的同一前缀。热身后稳步超过 90%。

### 2.1.3 Context Compaction（上下文压紧）

当输入 token 超过模型配置的上下文窗口时触发：

```typescript
models.profiles = {
  "deepseek-v4-pro": {
    contextWindowTokens: 1000000,  // 1M token 窗口
    contextCompaction: {
      softThreshold: 980000,       // 980K 开始触发
      hardThreshold: 990000        // 990K 强制触发
    }
  },
  "deepseek-v4-flash": {
    contextWindowTokens: 1000000,
    contextCompaction: {
      softThreshold: 980000,
      hardThreshold: 990000
    }
  }
}
```

**压缩保留的高价值信号：**

| 保留 | 丢弃 |
|---|---|
| `goal` 目标 | 历史中间推理步骤 |
| `constraints` 约束条件 | 失败的探索路径 |
| `decisions` 已做出的决策 | 过长无关的工具输出 |
| `touched files` 已接触文件 | 冗余的系统状态信息 |
| `tool outcomes` 工具执行结果 | |
| `unresolved next steps` 待办步骤 | |

**摘要模式：**
- `summaryMode = "heuristic"`（默认）：基于规则的快速压缩
- `summaryMode = "model"`：调用 LLM 生成结构化摘要，复用主 agent 的 system/few-shot 前缀；超时、空响应时降级到 heuristic

**全局默认阈值（无 model profile 时的兜底）：**
```json
{
  "defaultSoftThreshold": 96000,
  "defaultHardThreshold": 108800,
  "summaryTimeoutMs": 15000,
  "summaryMaxTokens": 1200,
  "summaryInputMaxBytes": 98304
}
```

### 2.1.4 Tool Storm 防护

同一轮内如果有完全相同的工具调用（相同工具名 + 相同参数），第二个及以后会被抑制：

```typescript
// runtimeTuning.toolStorm
// 原理：跟踪当前轮已调用的工具签名
const calledSignatures = new Set<string>();

function shouldSuppress(toolName: string, args: object): boolean {
    const sig = `${toolName}:${JSON.stringify(canonicalSort(args))}`;
    if (calledSignatures.has(sig)) {
        return true;  // 抑制，返回上次结果
    }
    calledSignatures.add(sig);
    return false;
}
```

这样可以防止模型因为工具输出未达预期而不停重复调用同一个工具直到 token 耗尽。

## 2.2 长期记忆系统

### 2.2.1 架构

```json
"capabilities.memory": {
    "enabled": false,
    "scopes": ["user", "workspace", "project"],  // 记忆作用域
    "maxInjectedRecords": 8                        // 每轮最多注入 8 条
}
```

三个作用域的设计体现了 **信息局部性**：
- `user`：用户偏好、常见问题（跨所有 workspace）
- `workspace`：当前工作区的项目规范、约定（跨 project）
- `project`：特定项目的架构决策、上下文

### 2.2.2 存储与工具接口

**存储**：`{data-dir}/memory/` 目录下的 JSON 文件，按 scope 索引。

**暴露给模型的工具：**
```
memory_create(scope, key, value) → 写一条记忆
memory_update(scope, key, value) → 更新已有记忆
memory_delete(scope, key)        → 删除记忆
```

**注入时机**：在每轮用户输入进入模型前，系统检索当前 scope 匹配的记忆记录，注入到上下文（最多 8 条）。

**局限性**：当前的记忆系统是 **key-value 存储**，没有语义检索。它依赖模型通过 `memory_create` 自行管理记忆的内容和键名，检索时按 scope + key 精确匹配，而非语义相似度匹配。这意味着：
- 模型需要精确知道记忆的 key 才能找到它
- 不存在"模糊搜索记忆"的能力
- 适合存储明确的配置项和约定，不适合存储可搜索的知识

## 2.3 MCP 集成与工具搜索范式

### 2.3.1 MCP 服务器配置

```json
"capabilities.mcp": {
    "enabled": false,
    "servers": {
        "github": {
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "trustScope": "workspace",
            "timeoutMs": 30000
        },
        "remote-docs": {
            "transport": "streamable-http",
            "url": "https://mcp.example.com/mcp",
            "trustScope": "user",
            "timeoutMs": 30000
        }
    }
}
```

### 2.3.2 MCP 搜索三部曲

这是 Kun 管理大型 MCP 工具目录的精髓。当工具 schema 很大，每轮携带所有工具定义会浪费大量 token 时，使用 3 步搜索范式：

```
Step 1: mcp_search(query)
  → 返回匹配的工具名称列表
  
Step 2: mcp_describe(tool_name)
  → 返回某个工具的完整 schema 和文档
  
Step 3: mcp_call(tool_name, args)
  → 执行工具调用
```

**设计意义**：替代"每轮携带全部工具 schema"的策略。模型先搜索需要什么工具，再获取详情的 schema，最后调用。典型场景是一个 MCP server 暴露了 50+ 个工具，每轮携带它们的全部 JSON Schema 可能消耗数千 token；通过搜索范式，只有实际需要的几个工具的 schema 才会在当轮出现。

### 2.3.3 Trust Scope 系统

每个 MCP 工具配一个信任范围：
- `workspace`：只能操作绑定的 workspace 目录
- `user`：可以操作用户目录
- `global`：最高权限

`trustedWorkspaceRoots` 进一步约束 workspace 范围。

## 2.4 Hooks 插件系统

### 2.4.1 生命周期钩子

Kun 在 Agent 生命周期的 6 个阶段暴露钩子：

```
UserPromptSubmit → PreToolUse → TurnStart → PostToolUse → TurnEnd → PreCompact
     ↓                 ↓                     ↓              ↓           ↓
   可拒绝/          可改写              仅观察          可改写       仅观察
   注入上下文        参数/审批                                          (压紧前)
```

### 2.4.2 钩子协议

```json
{
  "phase": "PreToolUse",       // 生命周期阶段
  "matcher": "bash|write_file", // 工具名 glob 匹配
  "command": "node guard.js",  // 外部脚本
  "timeoutMs": 10000            // 超时控制
}
```

**输入**：通过 stdin 接收 JSON（含 `phase` + `call`/`result`/`prompt` 等阶段特定字段）

**输出**：exit 0 + stdout JSON
```json
{"decision": "deny"}           // 拒绝工具调用
{"arguments": {"cmd": "ls"}}   // 重写参数
{"output": "...", "isError": true} // 重写结果
{"additionalContext": "..."}    // 注入额外上下文（仅 UserPromptSubmit）
```

**退出码语义**：
- `0`：成功，解析 stdout JSON
- `2`：阻止动作，stderr 作为原因
- 其他：非阻塞 warning

**可组合性**：钩子按声明顺序链式执行，每个钩子看到的是前一个钩子改写后的结果。

## 2.5 Token Economy（Token 经济学）

Kun 的 Token Economy 是贯穿整个系统的成本优化理念：

| 优化手段 | 实现 | 节约效果 |
|---|---|---|
| Stable Prefix Caching | 不可变前缀 + 指纹验证 | 系统提示和工具 schema 不重复发送 |
| 工具描述压缩 | 精简 schema JSON | 携带更少的键值对 |
| 工具结果截断 | 大输出被截断 | 防止 tool result 撑爆历史 |
| 历史上下文压缩 | 保留高价值信号 | 滚动窗口内始终在阈值内 |
| Tool Storm | 重复调用抑制 | 防止无用循环 |
| MCP 搜索范式 | 先搜索再获取 schema | 避免大目录全量携带 |
| Tool Schema Canonical Sort | 排序确保缓存稳定 | 防止顺序变化导致缓存 miss |
| Model-history repair | 修复孤儿 tool_call/tool_result | 防止 400 错误和重试 |

## 2.6 数据存储架构

### 2.6.1 目录布局

```
{data-dir}/
  config.json           # 运行时配置（模型、缓存、能力开关）
  index.sqlite3         # 线程元数据索引（可重建）
  attachments/          # 图片附件（二进制 + 元数据）
  memory/               # 长期记忆记录
  child-runs/           # 子 Agent 委派记录
  threads/
    {threadId}/
      thread.json       # 线程记录（ThreadRecord）
      messages.jsonl    # 消息追加日志（TurnItem append-only）
      events.jsonl      # 运行时事件日志（RuntimeEvent append-only）
      session.json      # AgentSession 快照
      usage.json        # 使用量快照
```

### 2.6.2 混合存储策略

默认使用 `hybrid` 模式：
- `threads/{threadId}/messages.jsonl` + `events.jsonl`：**权威日志**（append-only JSONL）
- `index.sqlite3`：**可重建索引**（线程元数据，用于快速列表和搜索）
- SQLite 索引损坏时，可通过重放 JSONL 重建

可选模式：
- `file`：纯粹 JSON 索引后端（传统模式）
- `sqlitePath`：自定义 SQLite 路径

**原子性与容错：**
- `index.json`、`thread.json`、`session.json`：原子 JSON 写入
- JSONL 流是 append-only，容忍脏行（重放时跳过损坏行）

---

# 第三部分：交叉对比分析

## 3.1 技术特性矩阵

| 维度 | Open WebUI | Kun |
|---|---|---|
| **编程语言** | Python (FastAPI + LangChain) + Svelte | TypeScript (Node.js + Zustand + React) |
| **RAG 范式** | 经典检索增强：摄取→分块→嵌入→存储→检索→生成 | Agentic RAG：缓存优先循环 + 上下文压紧 + 记忆注入 |
| **文档格式支持** | PDF/DOCX/XLSX/PPTX/HTML/Youtube/图片/源码 60+ | 无原生文档解析；依赖文件读取工具 + MCP 工具 |
| **向量数据库** | 14 个后端可切换（工厂模式） | **无**向量数据库 |
| **嵌入模型** | HuggingFace 本地模型 | 无独立嵌入；模型原生 1M 上下文窗口 |
| **检索算法** | BM25 + 向量搜索 + RRF 融合 + Rerank 重排 | MCP 搜索三部曲 + 记忆 KV 检索 + 缓存命中 |
| **内容提取引擎** | 7 种（Tika/Docling/Datalab/Mistral/MinerU/PaddleOCR/External） | URL + MCP 工具 |
| **异步架构** | asyncio + asyncio.to_thread 桥接同步向量库 | async/await + SSE 流式 |
| **缓存策略** | 间接：内容前缀辅助嵌入缓存 | 显式：ImmutablePrefix + 指纹验证 + LRU/TTL |
| **安全模型** | URL 验证（私有 IP 拦截）+ 文件访问控制 | 工具审批策略 + 沙箱模式 + 域名白名单 |
| **多租户** | 向量库级租户隔离（Milvus/Qdrant 多租户变体） | Scope 级隔离（user/workspace/project） |
| **部署复杂度** | 高（Python 依赖链 + 数据库选择 + 配置繁多） | 低（Node.js + 配置文件 + 无外部依赖） |
| **冷启动性能** | 首次索引慢（解析+嵌入+存储），检索后毫秒级 | 首轮无缓存，热身后 95%+ 命中 |
| **横向扩展** | 支持 PostgreSQL/S3 等后端扩展 | 无水平扩展能力（单进程运行时） |

## 3.2 架构哲学差异

| | Open WebUI | Kun |
|---|---|---|
| **核心信念** | 文档需要被精确索引才能被检索 | 模型足够聪明，不需要外部索引 |
| **Token 使用哲学** | Token 花在检索结果上 | Token 花在缓存前缀上 |
| **扩展方式** | 加新的向量库适配器 | 加新的 MCP 工具 |
| **错误处理** | 静默失败（try/except pass） | 显式错误传播（hook_warning events） |
| **配置哲学** | 大量环境变量控制 | 显式 JSON 配置 + 能力开关 |

Kun 的核心假设是：**模型上下文窗口越大，传统 RAG 的 ROI 越低**。当 DeepSeek V4 提供 1M token 上下文时，检索的边际价值确实在下降——因为模型可以直接"记住"足够多的历史。但这只适用于**对话历史**的重复利用，不适用于**外部知识库**的精确查找。

Open WebUI 的核心假设是：**知识必须被结构化存储才能被可靠检索**。这对于不能容忍幻觉（如法律、医疗、金融）的场景是必要的。

## 3.3 各自的盲区

**Open WebUI 的盲区：**
- 单文件 `retrieval/utils.py` 达 60KB，职责过重
- 缺乏对缓存命中的显式优化——每次查询都重新嵌入和检索
- CJK 编码检测虽然完善但复杂度过高（4 层 fallback）
- 14 个向量后端维护成本高，少量后端已足够覆盖大部分场景

**Kun 的盲区：**
- 没有真正的文档检索：长期记忆只是 key-value 存储，缺乏语义搜索
- 深度依赖模型自身能力（缓存命中率 >90% 的前提是 provider 支持 prompt caching）
- 无法回答"我没见过但文档里有"的问题
- 冷启动体验差：前几轮无缓存，且模型首次接触项目上下文延迟高

---

# 第四部分：Claude.Web 融合方案

## 4.1 设计原则

基于以上分析，为 Claude.Web（Node.js 全栈 + Express + ws + SQLite）定制 RAG 系统时，遵循 6 条原则：

```
原则1：零 Python 依赖
    → 所有组件用 JS/TS 实现，使用 sql.js / SQLite VSS 做向量

原则2：渐进式复杂度
    → 第一天：纯 BM25 关键词搜索（零部署）
    → 第二天：+ 向量搜索（安装 SQLite VSS 扩展）
    → 第三天：+ Rerank 重排（可选）

原则3：缓存优先，检索第二
    → 向 Kun 学习，System Prompt + Tool Schema 指纹缓存
    → 每轮检索结果也缓存（避免重复查同样的问题）

原则4：内容提取可插拔
    → 借鉴 Open WebUI 的策略模式
    → 文本/代码/PDF/Markdown 各用专用解析器

原则5：Agent Loop 与 RAG 融合
    → 工具审批 + 上下文压紧 + 记忆注入（Kun 模式）
    → 嵌入检索 + BM25 混合（Open WebUI 模式）

原则6：KISS - 保持简单
    → 不急于实现 14 个向量后端，先做 1 个
    → 不急于实现 7 种解析引擎，先做 3 个
```

## 4.2 分层架构

```
┌──────────────────────────────────────────────────────────────────┐
│                     Claude.Web RAG 架构                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: 内容提取（Content Extraction）                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  文本/代码 → TextLoader（纯 UTF-8/GB18030 自动检测）      │   │
│  │  Markdown → 内置 Markdown 分割器                          │   │
│  │  Web 内容 → fetch + HTML-to-Markdown 转换                 │   │
│  │  PDF → pdf.js（纯 JS PDF 解析）                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          ↓                                      │
│  Layer 2: 分块与嵌入（Chunking & Embedding）                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  递归字符分割器（RecursiveCharacterTextSplitter）         │   │
│  │  → 默认 chunk_size=512, chunk_overlap=128               │   │
│  │  → 支持 Markdown/MDX Headers 感知分割                     │   │
│  │  嵌入 API 调用（OpenAI / Ollama / 自定义）                │   │
│  │  → 异步批量嵌入（避免速率限制）                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          ↓                                      │
│  Layer 3: 向量存储（Vector Storage）                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  SQLite VSS（主选，零外部依赖）                          │   │
│  │  → sql.js + sql.js-vector-ext 扩展                       │   │
│  │  → 或 node-sqlite3 + VSS 加载模块                        │   │
│  │  PGVector（备选，已有 PostgreSQL 时使用）                 │   │
│  │  → @databases/pg 驱动                                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          ↓                                      │
│  Layer 4: 双通道检索（Dual-channel Retrieval）                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  通道A: BM25 全文搜索（纯 SQL LIKE / FTS5）              │   │
│  │  → 借鉴 Open WebUI 的内容富化                            │   │
│  │  → 文件名/标题/章节注入加权                              │   │
│  │  通道B: 向量相似性搜索（SQLite VSS）                      │   │
│  │  → 余弦距离 / L2 距离                                     │   │
│  │  RRF 融合 → 借鉴 Open WebUI 的内容哈希去重               │   │
│  │  可选 Rerank → 轻量交叉编码器或 LLM 重排                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          ↓                                      │
│  Layer 5: 缓存优化（Cache Optimization）                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  System Prompt + Tool Schema Fingerprint                │   │
│  │  → ImmutablePrefix（借鉴 Kun）                           │   │
│  │  检索结果 LRU 缓存                                      │   │
│  │  → 相同查询在 TTL 内不重复检索                           │   │
│  │  Context Compaction                                     │   │
│  │  → 保留 goal/decisions/touched files                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          ↓                                      │
│  Layer 6: Agent 集成（Agent Integration）                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  KAG: Knowledge-Augmented Generation Tool               │   │
│  │  → kag_search(query, top_k) 工具供模型调用              │   │
│  │  → 自动注入 top_k 检索结果到上下文                       │   │
│  │  记忆工具（借鉴 Kun）                                    │   │
│  │  → memory_save(key, content) → localStorage / SQLite    │   │
│  │  → memory_recall(key) → 检索记忆                        │   │
│  │  Tool Storm 防护（借鉴 Kun）                             │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## 4.3 具体实现路径

### Phase 1：基础 RAG（1-2 天）✅ 已完成

```
实际文件（2026-06-29 状态）：

src/rag/
├── chunker.js          ✅ RecursiveCharacterTextSplitter (512/128)
├── embedder.js         ✅ OpenAI / Ollama 嵌入 API，mock fallback
├── vectorStore.js      ✅ SQLite FTS5 (BM25) + 内存向量存储
├── retrieval.js        ✅ 双通道检索 + RRF 融合 (k=60)
├── index.js            ✅ RAG 系统入口（ingest / search / deleteCollection）
│
src/rag/extractors/
├── textExtractor.js    ✅ 纯文本读取 + CJK 编码检测（4 层 fallback）
├── markdownSplitter.js ✅ 按 Markdown 标题层级分割
└── webExtractor.js     ✅ fetch + HTML-to-Text（已增强见 Phase 3）

工具注册：src/server/tools/registry.js 已添加 rag_search 工具
WebSocket：src/server/routes/wsHandler.js 已接入 rag.search()
```

### Phase 2：缓存优化（1 天）✅ 已完成

```
实际文件（2026-06-29 状态）：

src/cache/
├── immutablePrefix.js  ✅ System Prompt + Tool Schema 指纹管理
├── lru.js              ✅ LRU/TTL 缓存（maxSize + ttl 配置）
└── contextCompactor.js ✅ 上下文压缩（保留 goal/decisions/touched files）

src/server/runtime/
└── promptBuilder.js    ✅ 集成缓存 + 压缩的 Prompt 构建器
                           - ImmutablePrefix 指纹缓存（getOrBuildPrefix）
                           - Context Compaction 自动触发（>maxHistoryChars）
                           - Tool Result 分区插入

[!] toolStorm.js（工具风暴防护）未实现
    原因：当前工具调用量级较小，同一轮内重复调用尚未成为问题
    待需要时按 Kun 的 pattern 补充：同一 clientId 同轮内对同一工具的重复调用自动抑制
```

### Phase 3：内容提取增强（1 天）✅ 已完成

```
实际文件（2026-06-29 状态）：

src/rag/extractors/
├── registry.js          ✅ 提取器注册表（优先级调度 + 错误兜底）
├── pdfExtractor.js      ✅ pdfjs-dist 解析 + 书签降级 + fake worker 模式
├── webExtractor.js      ✅ fetch + html-to-text（过滤导航/页脚，15s 超时）
├── restExtractor.js     ✅ REST API 提取（lodash.get dataPath 支持）
├── textFileExtractor.js ✅ 纯文本文件（重用 CJK 编码检测）
├── textExtractor.js     ✅ CJK 编码检测增强（4 层 fallback：utf-8→chardet→CJK→latin-1）
├── markdownSplitter.js  ✅ Markdown 层级分割（保留 headings metadata）
├── index.js             ✅ 统一导出 + createDefaultRegistry()

RAG 系统新增 API：
├── rag.ingestFile(path, collection)  ← 自动识别 PDF/文本/Markdown
├── rag.ingestUrl(url, collection)    ← 网页内容摄入
└── rag.ingestRest(source, collection) ← REST API 数据摄入（支持 dataPath）

路由（src/server/routes/ragRoutes.js）：
├── POST /api/rag/ingest          ← 文本 + base64 文件上传
├── POST /api/rag/ingest/url      ← URL 摄入
├── POST /api/rag/ingest/rest     ← REST API 摄入
├── POST /api/rag/search          ← 知识库搜索
├── GET  /api/rag/status           ← RAG 状态
├── GET  /api/rag/collections      ← 集合列表
└── DELETE /api/rag/collection/:name ← 删除集合

测试：src/rag/extractors/__tests__/phase3.test.js
      ├── ExtractorRegistry  4 tests ✓
      ├── PdfExtractor       3 tests ✓
      ├── WebExtractor       3 tests ✓
      ├── RestExtractor      4 tests ✓
      ├── TextFileExtractor  4 tests ✓
      └── RAG Integration    6 tests ✓
      总计 24 tests ✓

[!] externalLoader.js（Tika/Docling 外部解析桥接）未实现
    原因：pdfjs-dist + html-to-text 已覆盖核心用例
    需要时按 Open WebUI 的策略模式实现：先注册到 ExtractorRegistry
```

### Phase 4：生产化（1 天）✅ 已完成

```
实际文件（2026-06-29 状态）：

安全方面：
  ├── URL 验证         ✅ src/server/lib/urlValidator.js（SSRF 防护）
  │                       ├── 协议白名单（仅 http/https）
  │                       ├── 内网 IP 段拦截（10/172.16-31/192.168/127/0/169.254）
  │                       ├── 保留 IP 段拦截（240/100.64/198.18）
  │                       ├── 内网 hostname 拦截（localhost/.local/.internal）
  │                       ├── IPv6 环回拦截
  │                       └── 最大长度限制（4096 字符）
  │                   集成：
  │                       ├── WebExtractor — extract 前置验证
  │                       ├── RestExtractor — extract 前置验证
  │                       └── ragRoutes POST /ingest/url 和 /ingest/rest — 路由层验证
  ├── 路径遍历防护    ✅ 已在 fileRoutes.js 实现 pathResolve 检查
  └── 速率限制        ✅ 已在 server 层面实现（RATE_MAX_INPUT / RATE_WINDOW）

可观测性：
  ├── 检索延迟追踪    ✅ src/rag/metrics.js（滑动窗口 1000 次，p50/p95/p99 百分位）
  ├── 缓存命中率统计  ✅ 嵌入缓存命中/未命中分别计数
  ├── 嵌入 API 监控   ✅ 成功率 + 延迟追踪（每次 API 调用计时）
  └── 摄入统计        ✅ 摄入调用次数 + 块数累计
    暴露方式：
        ├── GET /api/rag/status  — 指标摘要（计数/成功率/缓存命中率）
        ├── GET /api/rag/metrics  — 全量指标（含百分位分布）
        └── rag.getMetricsSnapshot() — 编程访问

测试：
  ├── Phase 1 功能测试  ✅ src/rag/ 各模块
  ├── Phase 2 缓存测试  ✅ src/cache/__tests__/phase2.test.js
  ├── Phase 3 提取测试  ✅ src/rag/extractors/__tests__/phase3.test.js (24 tests)
  └── Phase 4 生产化测试 ✅ src/rag/__tests__/phase4.test.js (32 tests)
        ├── URL Validator  19 tests ✓（白名单/黑名单/边界用例全覆盖）
        ├── RAG Metrics     9 tests ✓（检索延迟/嵌入API/缓存/摄入/快照/重置）
        └── Integration     4 tests ✓（指标暴露/摄入追踪/快照形状/缓存命中验证）
```

## 4.4 技术选型决策

### 为什么选 SQLite VSS 而非其他向量库？

| 候选 | 优势 | 劣势 | 结论 |
|---|---|---|---|
| **SQLite VSS** | 零额外部署，与现有 sql.js 一致 | 仅支持余弦距离；非分布式 | ✅ **主选** |
| PGVector | 成熟，事务 ACID | 需要独立 PostgreSQL 服务 | ✅ **备选** |
| Chroma | 功能完善 | Python 原生，JS 客户端不成熟 | ❌ |
| Qdrant | 高性能过滤 | 额外服务部署 | ❌ 过度设计 |
| 内存向量 | 最简单 | 重启丢失 | ❌ 生产不可用 |

### 为什么选 `BM25 + 向量 RRF` 而非纯向量？

| 指标 | 纯向量搜索 | BM25 纯关键词 | BM25 + 向量 RRF |
|---|---|---|---|
| 语义匹配 | ★★★★★ | ★★ | ★★★★★ |
| 精确关键词 | ★★ | ★★★★★ | ★★★★★ |
| 代码搜索 | ★★ | ★★★★★ | ★★★★★ |
| 新领域适应 | ★★★★★ | ★★★ | ★★★★★ |
| 零样本迁移 | ★★★★★ | ★★★★ | ★★★★★ |

代码库中精确关键词搜索极为重要（函数名、类名、变量名），BM25 对此远优于向量搜索。而语义匹配处理同义词和概念层级又需要向量搜索。两者 RRF 融合是最优解。

## 4.5 融合方案的价值亮点

```
✨ 亮点1：零 Python 依赖
   全部基于 Node.js + sql.js，与现有项目一致
   不引入 Python 运行时、LangChain 链

✨ 亮点2：渐进式启用
   第一天：纯 BM25（0 外部依赖）
   第二天：+ SQLite VSS（安装扩展，1 行配置）
   第三天：+ Rerank（可选，配置 API key）

✨ 亮点3：缓存优先架构
   借鉴 Kun 的 ImmutablePrefix 指纹验证
   在 1M 上下文窗口模型下，缓存命中率可达 90%+
   大幅降低 Token 消耗和延迟

✨ 亮点4：双通道 RRF 融合
   BM25 + 向量搜索的最优组合
   借鉴 Open WebUI 的内容富化提升 BM25 质量
   内容哈希确保 RRF 去重

✨ 亮点5：KAG 工具范式
   将 RAG 封装为模型可调用的工具
   与现有 Tool Registry、Approval Gate 无缝集成
   可被审批、速率限制、日志追踪

✨ 亮点6：Agentic + 传统 RAG 融合
   既有传统文档检索的精确性（Open WebUI 优点）
   又有缓存优先的高效性（Kun 的优点）
```

## 4.6 与现有 Claude.Web 架构集成

```
实际代码结构（2026-06-29）：

src/
├── client/              ← 前端（不变）
├── server/
│   ├── index.js         ← 创建 rag 实例，注入 wsHandler / routes
│   ├── routes/
│   │   ├── ragRoutes.js ← POST /ingest /ingest/url /ingest/rest /search
│   │   │                   GET  /status /collections
│   │   │                   DELETE /collection/:name
│   │   └── wsHandler.js ← 已接入 rag_search 工具(done)
│   ├── runtime/
│   │   └── promptBuilder.js ← 集成 ImmutablePrefix + Context Compaction
│   └── tools/
│       └── registry.js  ← 已定义 rag_search 工具
│
├── rag/                 ← RAG 核心系统
│   ├── index.js         ← createRagSystem({ apiKey, baseUrl, ... })
│   ├── chunker.js       ← RecursiveCharacterTextSplitter
│   ├── embedder.js      ← OpenAI/Ollama 嵌入
│   ├── vectorStore.js   ← SQLite BM25 + 内存向量
│   ├── retrieval.js     ← 双通道检索 + RRF 融合
│   └── extractors/
│       ├── index.js          ← createDefaultRegistry()
│       ├── registry.js       ← ExtractorRegistry
│       ├── pdfExtractor.js   ← pdfjs-dist
│       ├── webExtractor.js   ← fetch + html-to-text
│       ├── restExtractor.js  ← REST API + lodash.get
│       ├── textFileExtractor.js ← 纯文本
│       ├── textExtractor.js  ← CJK 编码检测
│       └── markdownSplitter.js ← MDX 分割
│
└── cache/               ← 缓存子系统
    ├── immutablePrefix.js ← 系统提示指纹缓存
    ├── lru.js             ← LRU/TTL 缓存
    └── contextCompactor.js ← 上下文压缩
```

**已实现的集成点：**
1. `src/server/index.js`：启动时调用 `createRagSystem()` 初始化 RAG
2. `src/server/tools/registry.js`：添加 `rag_search` 工具供模型调用
3. `src/server/routes/wsHandler.js`：工具审批通过后调用 `rag.search()` 注入检索结果
4. `src/server/routes/ragRoutes.js`：RAG HTTP API 路由

[✓] Session 级知识库隔离已实现：HTTP RAG API 默认使用当前 `session.id`；自定义 collection 会命名空间化为 `${session.id}:${collection}`；WebSocket 自动 `rag_search` 也只使用当前 session 的 collection，不再回退到 `default`。

---

# 总结

**Open WebUI 适合**：企业级文档知识库、多格式文件解析、需要精确召回的场景。其成熟的内容提取管道、14 个向量后端选择和混合搜索算法是经过大规模验证的知识工程方案。

**Kun 适合**：以代码为中心的 Agent 工作流、需要长上下文对话的场景。其缓存优先架构和 Token Economy 理念代表了下一代 Agent 系统的方向——不依赖外部存储器，而是最大化复用已付出的 Token。

**Claude.Web 融合方案**：取两者之长——用 Open WebUI 的内容提取和混合搜索做精确知识库，用 Kun 的缓存策略和上下文管理做高效 Agent。在纯 Node.js 生态中用 SQLite VSS 实现轻量化、渐进式、企业就绪的 RAG 系统。
