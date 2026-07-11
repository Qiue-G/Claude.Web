<script>
  /**
   * Audit Log Viewer — admin-only panel for viewing audit logs.
   */
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n.js';
  $: _t = $t;

  let logs = [];
  let loading = false;
  let filter = { action: '', sessionId: '', startDate: '', endDate: '' };

  async function fetchLogs() {
    loading = true;
    try {
      const params = new URLSearchParams();
      if (filter.action) params.set('action', filter.action);
      if (filter.sessionId) params.set('sessionId', filter.sessionId);
      if (filter.startDate) params.set('startDate', filter.startDate);
      if (filter.endDate) params.set('endDate', filter.endDate);

      const res = await fetch('/api/admin/audit-logs?' + params.toString());
      if (res.ok) {
        const data = await res.json();
        logs = data.logs || [];
      } else {
        logs = [];
      }
    } catch (e) {
      console.error('Failed to fetch audit logs:', e);
      logs = [];
    } finally {
      loading = false;
    }
  }

  onMount(() => { fetchLogs(); });

  function formatTimestamp(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString();
  }

  function formatDetails(details) {
    if (!details) return '';
    return JSON.stringify(details);
  }
</script>

<div class="audit-panel">
  <div class="audit-header">
    <h4 class="audit-title">{_t('audit.title')}</h4>
    <button class="refresh-btn" onclick={fetchLogs} disabled={loading}>
      {loading ? _t('common.loading') : _t('audit.refresh')}
    </button>
  </div>

  <!-- Filters -->
  <div class="audit-filters">
    <input
      type="text"
      class="filter-input"
      bind:value={filter.action}
      placeholder={_t('audit.filterAction')}
      onkeydown={(e) => e.key === 'Enter' && fetchLogs()}
    />
    <input
      type="text"
      class="filter-input"
      bind:value={filter.sessionId}
      placeholder={_t('audit.filterSession')}
      onkeydown={(e) => e.key === 'Enter' && fetchLogs()}
    />
    <input
      type="date"
      class="filter-input"
      bind:value={filter.startDate}
    />
    <input
      type="date"
      class="filter-input"
      bind:value={filter.endDate}
    />
  </div>

  <!-- Log Table -->
  {#if logs.length > 0}
    <div class="log-table-wrapper">
      <table class="log-table">
        <thead>
          <tr>
            <th>{_t('audit.timestamp')}</th>
            <th>{_t('audit.action')}</th>
            <th>{_t('audit.resource')}</th>
            <th>{_t('audit.sessionId')}</th>
            <th>{_t('audit.details')}</th>
          </tr>
        </thead>
        <tbody>
          {#each logs as log}
            <tr>
              <td class="timestamp">{formatTimestamp(log.timestamp)}</td>
              <td><span class="action-badge">{log.action}</span></td>
              <td>{log.resource || '—'}</td>
              <td class="session-id">{log.sessionId || '—'}</td>
              <td class="details">{formatDetails(log.details)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="audit-empty">
      {loading ? _t('common.loading') : _t('audit.noLogs')}
    </div>
  {/if}
</div>

<style>
  .audit-panel { padding: 8px 0; }
  .audit-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .audit-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0; }
  .refresh-btn {
    padding: 4px 12px; font-size: 12px; background: var(--bg-input); border: 1px solid var(--border);
    border-radius: 6px; color: var(--text-secondary); cursor: pointer; font-family: var(--font-sans);
  }
  .refresh-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
  .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .audit-filters { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .filter-input {
    flex: 1; min-width: 120px; padding: 6px 10px; font-size: 12px;
    background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text-primary); font-family: var(--font-sans);
  }
  .filter-input::placeholder { color: var(--text-dim); }
  .log-table-wrapper { overflow-x: auto; }
  .log-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .log-table th {
    text-align: left; padding: 8px; border-bottom: 2px solid var(--border);
    color: var(--text-dim); font-weight: 500; white-space: nowrap;
  }
  .log-table td { padding: 8px; border-bottom: 1px solid var(--border); color: var(--text-secondary); }
  .log-table tr:hover td { background: var(--bg-hover); }
  .timestamp { white-space: nowrap; color: var(--text-dim); }
  .action-badge {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    background: rgba(245,158,11,0.1); color: var(--amber); font-size: 11px;
  }
  .session-id { font-family: var(--font-mono); font-size: 11px; }
  .details { font-family: var(--font-mono); font-size: 11px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .audit-empty { text-align: center; color: var(--text-dim); font-size: 13px; padding: 24px 0; }
</style>
