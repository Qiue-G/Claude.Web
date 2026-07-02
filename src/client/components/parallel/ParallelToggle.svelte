<script>
  import { t } from '$lib/i18n.js';
  import { parallelMode } from '../../stores/parallel.store.js';

  /** 所有可用模型列表 */
  let { models = [] } = $props();

  function toggleParallel() {
    parallelMode.update(v => !v);
    if (!$parallelMode) {
      // 关闭并行模式时清空选择
      selectedModels.set([]);
    }
  }

  // 导入 selectedModels 以在 toggle 时使用
  import { selectedModels } from '../../stores/parallel.store.js';
</script>

<button
  class="parallel-toggle"
  class:active={$parallelMode}
  onclick={toggleParallel}
  title={$parallelMode ? '关闭并行对比模式' : '开启并行对比模式（多模型同时输出）'}
>
  <span class="icon">⚡</span>
  <span class="label">{$t('parallel_mode')}</span>
</button>

<style>
  .parallel-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--border-color, #333);
    border-radius: 6px;
    background: var(--bg-secondary, #1a1a2e);
    color: var(--text-secondary, #888);
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
  }
  .parallel-toggle:hover {
    border-color: var(--accent-color, #6c5ce7);
    color: var(--text-primary, #eee);
  }
  .parallel-toggle.active {
    border-color: var(--accent-color, #6c5ce7);
    background: var(--accent-color, #6c5ce7);
    color: #fff;
  }
  .icon { font-size: 14px; }
</style>
