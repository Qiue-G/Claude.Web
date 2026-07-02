<script>
  /**
   * RAG Metrics Panel — displays retrieval/embedding/ingest statistics.
   */
  import { sessionId, sessionToken } from '$stores/session.store.js';
  import { t } from '$lib/i18n.js';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';

  $: _t = $t;

  let metrics = null;
  let loading = false;

  async function fetchMetrics() {
    loading = true;
    try {
      const sid = get(sessionId);
      const tok = get(sessionToken);
      const res = await fetch('/api/rag/metrics', {
        headers: { 'X-Session-Id': sid, 'X-Session-Token': tok }
      });
      if (res.ok) metrics = await res.json();
    } catch (e) {
      console.error('Failed to fetch RAG metrics:', e);
    } finally {
      loading = false;
    }
  }

  onMount(() => { fetchMetrics(); });

  function formatMs(ms) {
    if (ms === 0) return '—';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }

  function formatPct(pct) {
    if (pct === 0) return '—';
    return pct + '%';
  }
</script>

<div class="metrics-panel">
  <div class="metrics-header">
    <h4 class="metrics-title">{_t('rag.metrics.title')}</h4>
    <button class="refresh-btn" onclick={fetchMetrics} disabled={loading}>
      {loading ? _t('common.loading') : _t('rag.metrics.refresh')}
    </button>
  </div>

  {#if metrics}
    <!-- Search Latency -->
    <div class="metric-section">
      <h5 class="section-title">{_t('rag.metrics.search')}</h5>
      <div class="metric-grid">
        <div class="metric-card">
          <span class="metric-value">{metrics.search.count}</span>
          <span class="metric-label">{_t('rag.metrics.queries')}</span>
        </div>
        <div class="metric-card">
          <span class="metric-value">{formatMs(metrics.search.p50Ms)}</span>
          <span class="metric-label">P50</span>
        </div>
        <div class="metric-card">
          <span class="metric-value">{formatMs(metrics.search.p95Ms)}</span>
          <span class="metric-label">P95</span>
        </div>
        <div class="metric-card">
          <span class="metric-value">{formatMs(metrics.search.p99Ms)}</span>
          <span class="metric-label">P99</span>
        </div>
      </div>
    </div>

    <!-- Embedding API -->
    <div class="metric-section">
      <h5 class="section-title">{_t('rag.metrics.embed')}</h5>
      <div class="metric-grid">
        <div class="metric-card">
          <span class="metric-value">{metrics.embed.totalCalls}</span>
          <span class="metric-label">{_t('rag.metrics.calls')}</span>
        </div>
        <div class="metric-card">
          <span class="metric-value">{formatPct(metrics.embed.successRate)}</span>
          <span class="metric-label">{_t('rag.metrics.successRate')}</span>
        </div>
        <div class="metric-card">
          <span class="metric-value">{formatMs(metrics.embed.avgLatencyMs)}</span>
          <span class="metric-label">{_t('rag.metrics.avgLatency')}</span>
        </div>
        <div class="metric-card">
          <span class="metric-value">{formatPct(metrics.embed.cacheHitRate)}</span>
          <span class="metric-label">{_t('rag.metrics.cacheHitRate')}</span>
        </div>
      </div>
    </div>

    <!-- Ingest -->
    <div class="metric-section">
      <h5 class="section-title">{_t('rag.metrics.ingest')}</h5>
      <div class="metric-grid">
        <div class="metric-card">
          <span class="metric-value">{metrics.ingest.totalIngestCalls}</span>
          <span class="metric-label">{_t('rag.metrics.ingestCalls')}</span>
        </div>
        <div class="metric-card">
          <span class="metric-value">{metrics.ingest.totalChunksIngested}</span>
          <span class="metric-label">{_t('rag.metrics.chunks')}</span>
        </div>
      </div>
    </div>
  {:else}
    <div class="metrics-empty">{_t('rag.metrics.noData')}</div>
  {/if}
</div>

<style>
  .metrics-panel { padding: 8px 0; }
  .metrics-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .metrics-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0; }
  .refresh-btn {
    padding: 4px 12px; font-size: 12px; background: var(--bg-input); border: 1px solid var(--border);
    border-radius: 6px; color: var(--text-secondary); cursor: pointer; font-family: var(--font-sans);
  }
  .refresh-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
  .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .metric-section { margin-bottom: 16px; }
  .section-title { font-size: 12px; font-weight: 500; color: var(--text-dim); margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; }
  .metric-card {
    display: flex; flex-direction: column; align-items: center; padding: 12px 8px;
    background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px;
  }
  .metric-value { font-size: 18px; font-weight: 600; color: var(--amber); line-height: 1.2; }
  .metric-label { font-size: 11px; color: var(--text-dim); margin-top: 4px; }
  .metrics-empty { text-align: center; color: var(--text-dim); font-size: 13px; padding: 24px 0; }
</style>
