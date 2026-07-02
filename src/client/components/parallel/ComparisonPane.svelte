<script>
  import { t } from '$lib/i18n.js';
  import DiffHighlight from './DiffHighlight.svelte';
  import ResultSelector from './ResultSelector.svelte';

  let { modelId = '', text = '', status = 'running', latency = null, tokens = null, error = null, allTexts = {} } = $props();
</script>

<div class="comparison-pane" class:done={status === 'done'} class:error={status === 'error'}>
  <div class="pane-header">
    <span class="model-name">{modelId}</span>
    <div class="pane-stats">
      {#if status === 'running'}
        <span class="status-badge running">{$t('running')}...</span>
      {:else if status === 'done'}
        <span class="status-badge done">{$t('done')}</span>
        {#if latency}<span class="stat">⏱ {latency}ms</span>{/if}
        {#if tokens}<span class="stat">🔤 {tokens?.output || tokens || '?'}</span>{/if}
      {:else if status === 'error'}
        <span class="status-badge error">{$t('error')}</span>
      {/if}
    </div>
  </div>

  <div class="pane-content">
    {#if text}
      <DiffHighlight {text} {modelId} {allTexts} />
    {:else if status === 'running'}
      <div class="loading-indicator">
        <span class="dot-pulse"></span>
      </div>
    {:else if status === 'error'}
      <div class="error-message">{error || 'Model failed'}</div>
    {:else}
      <div class="placeholder">{$t('waiting_for_output')}</div>
    {/if}
  </div>

  <ResultSelector {modelId} {text} {status} {latency} {tokens} />
</div>

<style>
  .comparison-pane {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-primary, #0a0a0c);
    display: flex;
    flex-direction: column;
  }
  .pane-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: var(--bg-secondary, #1a1a2e);
    border-bottom: 1px solid var(--border-color, #333);
  }
  .model-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary, #eee);
  }
  .pane-stats {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .status-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
  }
  .status-badge.running {
    background: #2d3748;
    color: #63b3ed;
  }
  .status-badge.done {
    background: #22543d;
    color: #68d391;
  }
  .status-badge.error {
    background: #442222;
    color: #fc8181;
  }
  .stat {
    font-size: 11px;
    color: var(--text-muted, #666);
  }
  .pane-content {
    flex: 1;
    padding: 12px;
    overflow-y: auto;
    max-height: 400px;
  }
  .loading-indicator {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 40px;
  }
  .dot-pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-color, #6c5ce7);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.3; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
  }
  .error-message {
    color: #fc8181;
    font-size: 13px;
    padding: 20px;
    text-align: center;
  }
  .placeholder {
    color: var(--text-muted, #555);
    font-size: 13px;
    padding: 40px;
    text-align: center;
  }
</style>
