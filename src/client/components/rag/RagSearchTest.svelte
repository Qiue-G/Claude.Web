<script>
  /**
   * RAG 搜索测试面板
   */
  import { searchRag } from '$apis/rag.api.js';
  import { sessionId, sessionToken } from '$stores/session.store.js';
  import { get } from 'svelte/store';

  let { toast = () => {} } = $props();

  let query = $state('');
  let collection = $state('');
  let topK = $state(5);
  let bm25Weight = $state(0.3);
  let enableRerank = $state(false);
  let enableCrossEncoder = $state(false);
  let enableEnrichment = $state(true);
  let searching = $state(false);
  let results = $state([]);
  let error = $state('');

  async function handleSearch() {
    if (!query.trim()) return;
    const sid = get(sessionId);
    const tok = get(sessionToken);
    if (!sid || !tok) {
      error = '请先连接模型';
      return;
    }

    searching = true;
    error = '';
    results = [];
    try {
      const res = await searchRag({
        query: query.trim(),
        collection: collection || undefined,
        topK,
        bm25Weight,
        enableRerank,
        enableCrossEncoder,
        enableEnrichment,
        sessionId: sid,
        token: tok,
      });
      results = res.results || [];
      if (results.length === 0) {
        error = '未找到匹配结果';
      }
    } catch (e) {
      error = e.message || '搜索失败';
    } finally {
      searching = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  }

  function formatScore(score) {
    if (score == null) return '-';
    return score.toFixed(4);
  }
</script>

<div class="search-test">
  <h4>搜索测试</h4>

  <div class="field">
    <label class="field-label">搜索查询</label>
    <div class="search-row">
      <input
        type="text"
        class="input search-input"
        bind:value={query}
        onkeydown={handleKeydown}
        placeholder="输入搜索关键词..."
      />
      <button class="search-btn" onclick={handleSearch} disabled={searching || !query.trim()}>
        {searching ? '搜索中...' : '搜索'}
      </button>
    </div>
  </div>

  <div class="field-row">
    <div class="field half">
      <label class="field-label">集合（可选）</label>
      <input type="text" class="input" bind:value={collection} placeholder="留空默认" />
    </div>
    <div class="field half">
      <label class="field-label">Top K</label>
      <input type="number" class="input" bind:value={topK} min="1" max="50" />
    </div>
  </div>

  <div class="field-row">
    <div class="field half">
      <label class="field-label">BM25 权重</label>
      <input type="number" class="input" bind:value={bm25Weight} min="0" max="1" step="0.1" />
    </div>
    <div class="field half">
      <label class="field-label">余弦 Rerank</label>
      <label class="toggle">
        <input type="checkbox" bind:checked={enableRerank} />
        <span>启用</span>
      </label>
    </div>
  </div>
  <div class="field-row">
    <div class="field half">
      <label class="field-label">Cross-Encoder Rerank</label>
      <label class="toggle">
        <input type="checkbox" bind:checked={enableCrossEncoder} />
        <span>启用</span>
      </label>
    </div>
    <div class="field half">
      <label class="field-label">内容富化</label>
      <label class="toggle">
        <input type="checkbox" bind:checked={enableEnrichment} />
        <span>启用</span>
      </label>
    </div>
  </div>

  {#if error}
    <div class="error-msg">{error}</div>
  {/if}

  {#if results.length > 0}
    <div class="results-header">
      共 {results.length} 个结果
    </div>
    <div class="results">
      {#each results as r, i}
        <div class="result-item">
          <div class="result-score">
            <span class="score-badge">{formatScore(r.score)}</span>
          </div>
          <div class="result-text">{r.text}</div>
          {#if r.metadata?.filename || r.metadata?.source}
            <div class="result-meta">
              {#if r.metadata.filename}<span class="meta-tag">{r.metadata.filename}</span>{/if}
              {#if r.metadata.source && r.metadata.source !== r.metadata.filename}<span class="meta-tag">{r.metadata.source}</span>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .search-test { padding: 0; }
  h4 { margin: 0 0 12px; font-size: 14px; color: var(--text-primary); }
  .field { margin-bottom: 12px; }
  .field-label { display: block; font-size: 12px; color: var(--text-dim); margin-bottom: 4px; }
  .input {
    width: 100%; padding: 8px 10px; font-size: 13px; font-family: inherit;
    background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text-primary); outline: none; box-sizing: border-box;
  }
  .input:focus { border-color: var(--accent); }
  .search-row { display: flex; gap: 8px; }
  .search-input { flex: 1; }
  .search-btn {
    padding: 8px 16px; font-size: 13px; font-weight: 500;
    background: var(--amber); color: white; border: none; border-radius: 6px;
    cursor: pointer; white-space: nowrap; transition: all 0.15s;
  }
  .search-btn:hover { background: var(--amber-bright); }
  .search-btn:disabled { opacity: 0.5; cursor: default; }
  .field-row { display: flex; gap: 12px; }
  .field.half { flex: 1; }
  .toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; color: var(--text-primary); }
  .toggle input { width: 16px; height: 16px; }
  .error-msg { color: var(--red); font-size: 13px; margin: 8px 0; }
  .results-header { font-size: 12px; color: var(--text-dim); margin-bottom: 8px; }
  .results { display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; }
  .result-item {
    padding: 10px; border-radius: 6px; background: var(--bg-input);
    border: 1px solid var(--border);
  }
  .result-score { margin-bottom: 4px; }
  .score-badge {
    font-size: 11px; padding: 1px 6px; border-radius: 4px;
    background: var(--bg-accent-dim); color: var(--accent); font-family: var(--font-mono);
  }
  .result-text {
    font-size: 13px; color: var(--text-primary); line-height: 1.5;
    white-space: pre-wrap; word-break: break-word;
  }
  .result-meta { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
  .meta-tag {
    font-size: 11px; padding: 1px 6px; border-radius: 3px;
    background: var(--bg-hover); color: var(--text-dim);
  }
</style>