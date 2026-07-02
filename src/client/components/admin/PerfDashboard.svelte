<script>
  /**
   * Performance Dashboard — 实时显示 API 延迟、DB 查询等性能指标
   */
  import { onMount, onDestroy } from 'svelte';
  import { t } from '$lib/i18n.js';
  $: _t = $t;

  let snapshot = null;
  let loading = false;
  let autoRefresh = true;
  let intervalId = null;

  async function fetchPerf() {
    loading = true;
    try {
      const res = await fetch('/api/perf');
      if (!res.ok) throw new Error('Failed to fetch perf data');
      snapshot = await res.json();
    } catch (err) {
      console.error('[PerfDashboard] fetch error:', err.message);
      snapshot = null;
    } finally {
      loading = false;
    }
  }

  function toggleAutoRefresh() {
    autoRefresh = !autoRefresh;
  }

  onMount(() => {
    fetchPerf();
    if (autoRefresh) {
      intervalId = setInterval(fetchPerf, 5000);
    }
  });

  // React to autoRefresh changes
  $: {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (autoRefresh) {
      intervalId = setInterval(fetchPerf, 5000);
    }
  }

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId);
  });

  function formatMs(ms) {
    if (ms == null || ms === 0) return '-';
    return (ms).toFixed(1) + 'ms';
  }

  function entries(obj) {
    return obj ? Object.entries(obj) : [];
  }

  function getBarWidth(value, maxValue) {
    if (!maxValue || maxValue === 0) return '0%';
    return Math.min(100, (value / maxValue) * 100) + '%';
  }
</script>

<div class="perf-dashboard">
  <div class="perf-header">
    <h3>{_t('perf.title')}</h3>
    <div class="perf-controls">
      <label class="auto-refresh-toggle">
        <input type="checkbox" checked={autoRefresh} oninput={toggleAutoRefresh} />
        {_t('perf.autoRefresh')}
      </label>
      <button class="refresh-btn" onclick={fetchPerf} disabled={loading}>
        {_t('perf.refreshNow')}
      </button>
    </div>
  </div>

  {#if loading && !snapshot}
    <div class="perf-loading">{_t('common.loading') || 'Loading...'}</div>
  {:else if !snapshot || (entries(snapshot.api).length === 0 && snapshot.db.count === 0 && entries(snapshot.custom).length === 0)}
    <div class="perf-empty">{_t('perf.noData')}</div>
  {:else}
    <!-- API Latency -->
    {#if entries(snapshot.api).length > 0}
      <section class="perf-section">
        <h4>{_t('perf.apiLatency')}</h4>
        <div class="perf-table-wrap">
          <table class="perf-table">
            <thead>
              <tr>
                <th>{_t('perf.route')}</th>
                <th>{_t('perf.count')}</th>
                <th>{_t('perf.p50')}</th>
                <th>{_t('perf.p95')}</th>
                <th>{_t('perf.p99')}</th>
                <th>{_t('perf.avg')}</th>
              </tr>
            </thead>
            <tbody>
              {#each entries(snapshot.api) as [route, data]}
                <tr>
                  <td class="route-cell">{route}</td>
                  <td>{data.count}</td>
                  <td class="latency-cell">{formatMs(data.p50)}</td>
                  <td class="latency-cell">{formatMs(data.p95)}</td>
                  <td class="latency-cell">{formatMs(data.p99)}</td>
                  <td class="latency-cell">{formatMs(data.avg)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    <!-- DB Query -->
    {#if snapshot.db.count > 0}
      <section class="perf-section">
        <h4>{_t('perf.dbQuery')}</h4>
        <div class="perf-metrics-grid">
          <div class="metric-card">
            <span class="metric-label">{_t('perf.count')}</span>
            <span class="metric-value">{snapshot.db.count}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">{_t('perf.p50')}</span>
            <span class="metric-value">{formatMs(snapshot.db.p50)}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">{_t('perf.p95')}</span>
            <span class="metric-value">{formatMs(snapshot.db.p95)}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">{_t('perf.p99')}</span>
            <span class="metric-value">{formatMs(snapshot.db.p99)}</span>
          </div>
        </div>
      </section>
    {/if}

    <!-- Custom Metrics -->
    {#if entries(snapshot.custom).length > 0}
      <section class="perf-section">
        <h4>{_t('perf.customMetrics')}</h4>
        <div class="perf-table-wrap">
          <table class="perf-table">
            <thead>
              <tr>
                <th>{_t('perf.metric')}</th>
                <th>{_t('perf.count')}</th>
                <th>{_t('perf.p50')}</th>
                <th>{_t('perf.p95')}</th>
                <th>{_t('perf.p99')}</th>
              </tr>
            </thead>
            <tbody>
              {#each entries(snapshot.custom) as [name, data]}
                <tr>
                  <td>{name}</td>
                  <td>{data.count}</td>
                  <td>{formatMs(data.p50)}</td>
                  <td>{formatMs(data.p95)}</td>
                  <td>{formatMs(data.p99)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .perf-dashboard {
    padding: 0;
    font-size: 13px;
    color: var(--text-primary, #ccc);
  }
  .perf-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .perf-header h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary, #eee);
  }
  .perf-controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .auto-refresh-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-secondary, #999);
  }
  .auto-refresh-toggle input[type="checkbox"] {
    accent-color: var(--accent, #4f8ff7);
  }
  .refresh-btn {
    padding: 4px 12px;
    border: 1px solid var(--border, #444);
    background: var(--bg-raised, #222);
    color: var(--text-primary, #ccc);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .refresh-btn:hover {
    background: var(--bg-hover, #333);
  }
  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .perf-loading,
  .perf-empty {
    text-align: center;
    padding: 40px 0;
    color: var(--text-secondary, #888);
  }
  .perf-section {
    margin-bottom: 20px;
  }
  .perf-section h4 {
    margin: 0 0 8px 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary, #999);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .perf-table-wrap {
    overflow-x: auto;
  }
  .perf-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .perf-table th {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border, #333);
    color: var(--text-secondary, #888);
    font-weight: 500;
    white-space: nowrap;
  }
  .perf-table td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border, #222);
    white-space: nowrap;
  }
  .route-cell {
    font-family: 'SF Mono', 'Consolas', monospace;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .latency-cell {
    font-family: 'SF Mono', 'Consolas', monospace;
    text-align: right;
  }
  .perf-metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
  }
  .metric-card {
    background: var(--bg-raised, #1a1a2e);
    border: 1px solid var(--border, #333);
    border-radius: 6px;
    padding: 12px;
    text-align: center;
  }
  .metric-label {
    display: block;
    font-size: 11px;
    color: var(--text-secondary, #888);
    margin-bottom: 4px;
  }
  .metric-value {
    display: block;
    font-size: 18px;
    font-weight: 600;
    font-family: 'SF Mono', 'Consolas', monospace;
    color: var(--accent, #4f8ff7);
  }
</style>
