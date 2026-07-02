<script>
  import { t } from '$lib/i18n.js';
  import { parallelResults, parallelRunning, parallelSummary, selectedModels, resetParallel } from '../../stores/parallel.store.js';
  import ComparisonPane from './ComparisonPane.svelte';
  import { get } from 'svelte/store';

  let { ws = null } = $props();

  /** 收集所有模型的文本用于差异比较 */
  function getAllTexts() {
    const results = $parallelResults;
    const texts = {};
    for (const [id, r] of Object.entries(results)) {
      texts[id] = r?.text || '';
    }
    return texts;
  }

  /** 根据模型结果统计差异 */
  function getDifferences() {
    const results = $parallelResults;
    const models = Object.keys(results).filter(id => results[id]?.status === 'done');
    if (models.length < 2) return null;

    const linesMap = {};
    for (const modelId of models) {
      const text = results[modelId].text || '';
      const lines = [...new Set(text.split('\n').map(l => l.trim()).filter(l => l))];
      for (const line of lines) {
        if (!linesMap[line]) linesMap[line] = [];
        linesMap[line].push(modelId);
      }
    }

    const commonCount = Object.values(linesMap).filter(arr => arr.length === models.length).length;
    const uniqueLines = {};
    for (const modelId of models) {
      const text = results[modelId].text || '';
      const lines = new Set(text.split('\n').map(l => l.trim()).filter(l => l));
      let uniqueCount = 0;
      for (const line of lines) {
        if (linesMap[line] && linesMap[line].length === 1) uniqueCount++;
      }
      uniqueLines[modelId] = uniqueCount;
    }

    return { commonLines: commonCount, uniqueLines, modelCount: models.length };
  }

  /** 处理采纳结果事件 */
  function handleSelectResult(e) {
    const { modelId, text } = e.detail;
    if (!text) return;

    // 将结果插入到聊天
    const event = new CustomEvent('parallel-result-selected', {
      bubbles: true,
      detail: { modelId, text }
    });
    window.dispatchEvent(event);
  }

  let allTexts = $derived(getAllTexts());
  let diffs = $derived(getDifferences());
</script>

{#if $parallelRunning || Object.keys($parallelResults).length > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="comparison-view" onselect-result={handleSelectResult}>
    <div class="view-header">
      <span class="view-title">
        {$t('parallel_comparison')}
        {#if $parallelRunning}
          <span class="badge-running">{$t('running')}...</span>
        {:else}
          <span class="badge-done">{$t('completed')}</span>
        {/if}
      </span>
      <div class="view-actions">
        {#if !$parallelRunning}
          <button class="action-btn" onclick={() => resetParallel()}>
            ✕ {$t('close')}
          </button>
        {/if}
      </div>
    </div>

    <!-- 差异摘要 -->
    {#if diffs && diffs.modelCount >= 2}
      <div class="diff-summary">
        <div class="diff-title">{$t('difference_analysis')}</div>
        <div class="diff-stats">
          <span class="diff-item common">{$t('common_lines')}: {diffs.commonLines}</span>
          {#each Object.entries(diffs.uniqueLines) as [modelId, count]}
            <span class="diff-item unique">
              {modelId}: {count} {$t('unique_lines')}
            </span>
          {/each}
        </div>
      </div>
    {/if}

    <!-- 模型列 -->
    <div class="columns">
      {#each $selectedModels as modelId}
        {#if $parallelResults[modelId]}
          <ComparisonPane
            modelId={modelId}
            text={$parallelResults[modelId].text || ''}
            status={$parallelResults[modelId].status || 'running'}
            latency={$parallelResults[modelId].latency}
            tokens={$parallelResults[modelId].tokens}
            error={$parallelResults[modelId].error}
            allTexts={allTexts}
          />
        {/if}
      {/each}
    </div>

    <!-- 摘要 -->
    {#if $parallelSummary}
      <div class="summary-bar">
        <span>{$t('total_tokens')}: {$parallelSummary.totalTokens || 0}</span>
        <span>{$t('avg_latency')}: {$parallelSummary.avgLatency || 0}ms</span>
        <span>{$t('success_count')}: {$parallelSummary.successCount}/{$parallelSummary.modelCount}</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .comparison-view {
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    background: var(--bg-secondary, #1a1a2e);
    margin: 8px 0;
    overflow: hidden;
  }
  .view-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color, #333);
  }
  .view-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary, #eee);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .badge-running {
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 8px;
    background: #2d3748;
    color: #63b3ed;
  }
  .badge-done {
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 8px;
    background: #22543d;
    color: #68d391;
  }
  .view-actions {
    display: flex;
    gap: 4px;
  }
  .action-btn {
    background: none;
    border: 1px solid var(--border-color, #444);
    color: var(--text-secondary, #888);
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .action-btn:hover {
    border-color: var(--accent-color, #6c5ce7);
    color: var(--text-primary, #eee);
  }
  .diff-summary {
    padding: 8px 12px;
    background: var(--bg-tertiary, #111);
    border-bottom: 1px solid var(--border-color, #333);
  }
  .diff-title {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-muted, #666);
    margin-bottom: 4px;
  }
  .diff-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .diff-item {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .diff-item.common {
    background: #22543d33;
    color: #68d391;
  }
  .diff-item.unique {
    background: #44332233;
    color: #f6ad55;
  }
  .columns {
    display: flex;
    gap: 8px;
    padding: 8px;
    min-height: 200px;
  }
  .summary-bar {
    display: flex;
    gap: 16px;
    padding: 6px 12px;
    border-top: 1px solid var(--border-color, #333);
    font-size: 11px;
    color: var(--text-muted, #666);
  }
</style>
