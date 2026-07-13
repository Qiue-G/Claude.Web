<script>
  import { onMount } from 'svelte';
  
  let stats = { uptime: 0, memory: {}, sessions: {}, messages: {}, models: {} };
  let sessions = [];
  let loading = true;
  let error = '';
  let tokenInput = '';
  let ADMIN_TOKEN = localStorage.getItem('admin_token') || '';

  function saveToken() {
    localStorage.setItem('admin_token', tokenInput);
    ADMIN_TOKEN = tokenInput;
    fetchStats();
  }

  async function fetchStats() {
    loading = true;
    error = '';
    try {
      const headers = { 'Authorization': `Bearer ${ADMIN_TOKEN}` };
      const [statsRes, sessionsRes] = await Promise.all([
        fetch('/api/admin/stats', { headers }),
        fetch('/api/admin/sessions', { headers })
      ]);
      if (statsRes.ok) {
        const data = await statsRes.json();
        // Ensure all required fields exist with safe defaults
        stats = {
          uptime: data.uptime || 0,
          memory: {
            heapUsedMB: data.memory?.heapUsedMB || 0,
            heapTotalMB: data.memory?.heapTotalMB || 0,
            rssMB: data.memory?.rssMB || 0
          },
          sessions: {
            active: data.sessions?.active || 0,
            withProxy: data.sessions?.withProxy || 0,
            withProcess: data.sessions?.withProcess || 0
          },
          messages: { total: data.messages?.total || 0 },
          models: data.models || {}
        };
      } else if (statsRes.status === 401) {
        error = 'Admin token 无效或缺失 (设置 ADMIN_TOKEN 环境变量并配置 localStorage.admin_token)';
      } else {
        error = `API error: ${statsRes.status}`;
      }
      if (sessionsRes.ok) sessions = (await sessionsRes.json()).sessions || [];
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function killSession(sid) {
    if (!confirm(`强制关闭会话 ${sid.substring(0, 8)}...？`)) return;
    await fetch(`/api/admin/sessions/${sid}/kill`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
    });
    fetchStats();
  }

  function formatMB(n) { return `${Math.round(n)}MB`; }
  function formatUptime(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
  }

  onMount(fetchStats);
</script>

<div class="admin-panel">
  <div class="admin-header">
    <h2>⚙️ 管理面板</h2>
    <button class="refresh-btn" onclick={fetchStats} disabled={loading}>
      {loading ? '加载中...' : '🔄 刷新'}
    </button>
  </div>

  {#if error}
    <div class="error">{error}</div>
    <div class="token-input-row">
      <input
        type="password"
        bind:value={tokenInput}
        placeholder="Admin Token (设置后刷新)"
        class="token-input"
      />
      <button class="save-token-btn" onclick={saveToken}>保存</button>
    </div>
  {/if}

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">{formatUptime(stats.uptime)}</div>
      <div class="stat-label">运行时间</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{stats.sessions.active}</div>
      <div class="stat-label">活跃会话</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{formatMB(stats.memory.rssMB)}</div>
      <div class="stat-label">内存 RSS</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{stats.messages.total}</div>
      <div class="stat-label">消息总数</div>
    </div>
  </div>

  <div class="detail-grid">
    <div class="detail-card">
      <span>代理进程</span>
      <strong>{stats.sessions.withProxy}</strong>
    </div>
    <div class="detail-card">
      <span>CLI 进程</span>
      <strong>{stats.sessions.withProcess}</strong>
    </div>
    <div class="detail-card">
      <span>堆内存</span>
      <strong>{formatMB(stats.memory.heapUsedMB)} / {formatMB(stats.memory.heapTotalMB)}</strong>
    </div>
  </div>

  {#if Object.keys(stats.models).length > 0}
    <h3>模型分布</h3>
    <div class="models-list">
      {#each Object.entries(stats.models) as [model, count]}
        <div class="model-row">
          <span class="model-name">{model}</span>
          <span class="model-count">{count}</span>
        </div>
      {/each}
    </div>
  {/if}

  <h3>会话列表 ({sessions.length})</h3>
  <div class="sessions-table">
    <div class="session-row header">
      <span>ID</span>
      <span>模型</span>
      <span>代理</span>
      <span>操作</span>
    </div>
    {#each sessions as s}
      <div class="session-row">
        <span class="session-id" title={s.sessionId}>{s.sessionId.substring(0, 10)}...</span>
        <span class="session-model">{s.model?.substring(0, 25) || '—'}</span>
        <span>{s.proxyAlive ? '✅' : '❌'}</span>
        <button class="kill-btn" onclick={() => killSession(s.sessionId)} title="强制关闭">
          🗑️
        </button>
      </div>
    {/each}
  </div>
</div>

<style>
  .admin-panel {
    background: var(--ds-surface, #fff);
    border-radius: 12px;
    padding: 20px;
    max-width: 800px;
    margin: 0 auto;
    font-size: 14px;
  }
  .admin-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  .admin-header h2 { margin: 0; font-size: 18px; }
  .refresh-btn {
    padding: 6px 14px;
    border: 1px solid var(--ds-border, #ddd);
    border-radius: 6px;
    background: var(--ds-surface-2, #f5f5f5);
    cursor: pointer;
    font-size: 13px;
  }
  .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .error {
    background: #ffe0e0;
    color: #c00;
    padding: 10px;
    border-radius: 6px;
    margin-bottom: 12px;
  }
  .token-input-row {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
  }
  .token-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--ds-border, #ddd);
    border-radius: 6px;
    font-size: 12px;
    font-family: monospace;
  }
  .save-token-btn {
    padding: 6px 14px;
    background: var(--ds-accent, #7a5fd0);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
  }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
  .stat-card {
    background: var(--ds-surface-2, #f5f5f5);
    padding: 12px;
    border-radius: 8px;
    text-align: center;
  }
  .stat-value { font-size: 24px; font-weight: 700; color: var(--ds-accent, #7a5fd0); }
  .stat-label { font-size: 12px; color: var(--ds-text-2, #888); margin-top: 4px; }
  .detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
  .detail-card {
    background: var(--ds-surface-2, #f5f5f5);
    padding: 8px 12px;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    font-size: 13px;
  }
  .detail-card span { color: var(--ds-text-2, #888); }
  h3 { font-size: 15px; margin: 16px 0 8px; }
  .models-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
  .model-row {
    background: var(--ds-surface-2, #f5f5f5);
    padding: 4px 10px;
    border-radius: 6px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .model-name { font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .model-count { font-weight: 600; color: var(--ds-accent, #7a5fd0); }
  .sessions-table { border: 1px solid var(--ds-border, #ddd); border-radius: 8px; overflow: hidden; }
  .session-row {
    display: grid;
    grid-template-columns: 1fr 2fr 0.5fr 0.5fr;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--ds-border, #eee);
    align-items: center;
    font-size: 12px;
  }
  .session-row.header { font-weight: 600; background: var(--ds-surface-2, #f5f5f5); font-size: 11px; }
  .session-row:last-child { border-bottom: none; }
  .session-id { font-family: monospace; }
  .kill-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .kill-btn:hover { background: #ffe0e0; }
</style>
