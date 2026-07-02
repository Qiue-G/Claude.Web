<script>
  /**
   * ResultSelector — 选择最佳结果组件
   * 显示在单个模型面板底部，一键将结果采纳到聊天
   *
   * Props:
   *   modelId   - 模型 ID
   *   text      - 模型输出文本
   *   status    - 模型状态 ('done' | 'error' | 'running')
   *   latency   - 延迟 (ms)
   *   tokens    - token 数
   */
  import { t } from '$lib/i18n.js';

  let { modelId = '', text = '', status = 'running', latency = null, tokens = null } = $props();

  function handleSelect() {
    if (!text || status !== 'done') return;
    // 通过 CustomEvent 将结果发送到父组件
    const event = new CustomEvent('select-result', {
      bubbles: true,
      detail: { modelId, text, latency, tokens }
    });
    document.querySelector('.comparison-view')?.dispatchEvent(event);
  }
</script>

{#if status === 'done' && text}
  <button class="select-btn" onclick={handleSelect} title="{$t('select_result')}">
    <span class="check-icon">✓</span>
    {$t('select_result')}
  </button>
{/if}

<style>
  .select-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 6px 12px;
    border: 1px solid var(--border-color, #333);
    border-top: none;
    background: var(--bg-secondary, #1a1a2e);
    color: var(--accent-color, #4f8ff7);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.15s;
  }
  .select-btn:hover {
    background: var(--accent-color, #4f8ff7);
    color: #fff;
    border-color: var(--accent-color, #4f8ff7);
  }
  .check-icon {
    font-size: 14px;
    font-weight: bold;
  }
</style>
