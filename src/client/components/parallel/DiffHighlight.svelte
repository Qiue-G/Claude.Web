<script>
  /**
   * DiffHighlight — 差异高亮组件
   * 在模型输出文本中高亮显示独有内容 vs 共同内容
   *
   * Props:
   *   text        - 当前模型的输出文本
   *   modelId     - 当前模型 ID
   *   allTexts    - { modelId: text } 所有模型的输出
   */
  import { t } from '$lib/i18n.js';

  let { text = '', modelId = '', allTexts = {} } = $props();

  /**
   * 计算每行文本的差异类型
   * @returns {Array<{line: string, type: 'common'|'unique'|'normal', index: number}>}
   */
  function computeLineDiff() {
    if (!text) return [];
    const lines = text.split('\n');
    const otherTexts = Object.entries(allTexts)
      .filter(([id]) => id !== modelId)
      .map(([, t]) => t || '');

    if (otherTexts.length === 0) {
      return lines.map((line, i) => ({ line, type: 'normal', index: i }));
    }

    return lines.map((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return { line, type: 'normal', index: i };

      // 检查当前行是否出现在所有其他模型中
      const appearsInAll = otherTexts.every(other =>
        other.split('\n').some(l => l.trim() === trimmed)
      );

      if (appearsInAll) return { line, type: 'common', index: i };

      // 检查当前行是否只出现在此模型中
      const appearsInAny = otherTexts.some(other =>
        other.split('\n').some(l => l.trim() === trimmed)
      );

      if (!appearsInAny) return { line, type: 'unique', index: i };
      return { line, type: 'normal', index: i };
    });
  }

  let diffLines = $derived(computeLineDiff());
</script>

<div class="diff-highlight">
  {#each diffLines as dl}
    <span
      class="diff-line"
      class:common={dl.type === 'common'}
      class:unique={dl.type === 'unique'}
    >{dl.line}</span>
  {/each}
</div>

{#if diffLines.some(d => d.type === 'common') || diffLines.some(d => d.type === 'unique')}
  <div class="diff-legend">
    <span class="legend-item">
      <span class="legend-dot common-dot"></span>
      {$t('common_lines')}
    </span>
    <span class="legend-item">
      <span class="legend-dot unique-dot"></span>
      {$t('unique_lines')}
    </span>
  </div>
{/if}

<style>
  .diff-highlight {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .diff-line {
    display: inline;
    transition: background 0.2s;
    border-radius: 2px;
  }
  .diff-line.common {
    background: rgba(104, 211, 145, 0.08);
    border-bottom: 1px solid rgba(104, 211, 145, 0.2);
  }
  .diff-line.unique {
    background: rgba(246, 173, 85, 0.1);
    border-bottom: 1px solid rgba(246, 173, 85, 0.25);
  }
  .diff-legend {
    display: flex;
    gap: 12px;
    padding: 6px 0 0;
    font-size: 11px;
    color: var(--text-muted, #666);
    border-top: 1px solid var(--border-color, #222);
    margin-top: 8px;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    display: inline-block;
  }
  .common-dot {
    background: rgba(104, 211, 145, 0.5);
  }
  .unique-dot {
    background: rgba(246, 173, 85, 0.5);
  }
</style>
