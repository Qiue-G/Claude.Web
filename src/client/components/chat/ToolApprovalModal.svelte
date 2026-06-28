<script>
  /**
   * 工具审批弹窗组件
   * AI 请求调用工具时，弹窗让用户选择允许或拒绝
   */
  import Icon from '$components/common/Icon.svelte';

  let {
    pendingTools = [],
    approvalId = null,
    onapprove = null,
    onreject = null
  } = $props();

  let selected = $state([]);

  // 默认全选
  $effect(() => {
    selected = pendingTools.map(t => t.id);
  });

  function toggleTool(toolId) {
    if (selected.includes(toolId)) {
      selected = selected.filter(id => id !== toolId);
    } else {
      selected = [...selected, toolId];
    }
  }

  function approve() {
    onapprove?.(approvalId, selected);
  }

  function rejectAll() {
    onreject?.(approvalId, []);
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      rejectAll();
    }
  }
</script>

{#if pendingTools.length > 0}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="approval-backdrop" role="presentation" onclick={handleBackdropClick}>
    <div class="approval-modal" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      <header class="approval-header">
        <h2 id="approval-title" class="approval-title">工具调用审批</h2>
        <p class="approval-subtitle">AI 请求调用以下工具，请选择允许执行的工具：</p>
      </header>

      <div class="approval-tools">
        {#each pendingTools as tool (tool.id)}
          <button
            class="tool-option"
            class:selected={selected.includes(tool.id)}
            onclick={() => toggleTool(tool.id)}
          >
            <span class="tool-check">
              {#if selected.includes(tool.id)}
                <Icon name="check" size="sm" />
              {/if}
            </span>
            <span class="tool-label">{tool.label}</span>
          </button>
        {/each}
      </div>

      <div class="approval-actions">
        <button class="btn btn-secondary" onclick={rejectAll}>
          全部拒绝
        </button>
        <button class="btn btn-primary" onclick={approve} disabled={selected.length === 0}>
          允许选中的 {selected.length > 0 ? `(${selected.length})` : ''}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .approval-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 800;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .approval-modal {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    max-width: 420px;
    width: 90%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .approval-header {
    margin-bottom: 20px;
  }

  .approval-title {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 8px 0;
    color: var(--text-primary);
  }

  .approval-subtitle {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
  }

  .approval-tools {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 20px;
  }

  .tool-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-base);
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
    color: var(--text-primary);
    font-size: 14px;
    width: 100%;
  }

  .tool-option:hover {
    border-color: var(--amber);
    background: var(--bg-raised);
  }

  .tool-option.selected {
    border-color: var(--amber);
    background: var(--bg-accent-dim);
  }

  .tool-check {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: transparent;
    transition: all 0.15s ease;
  }

  .tool-option.selected .tool-check {
    border-color: var(--amber);
    background: var(--amber);
    color: #000;
  }

  .tool-label {
    font-weight: 500;
  }

  .approval-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }

  .btn {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.15s ease;
  }

  .btn-primary {
    background: var(--amber);
    color: #000;
  }

  .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-primary:not(:disabled):hover {
    opacity: 0.9;
  }

  .btn-secondary {
    background: var(--bg-raised);
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .btn-secondary:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
