<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '$components/common/Icon.svelte';
  import { t } from '$lib/i18n.js';
  import { fetchTools } from '$apis/tools.api.js';
  import { availableTools, setAvailableTools, setToolEnabled, toolStates as toolStatesStore } from '$stores/tools.store.js';

  /** @type {boolean} */
  export let open = false;

  const dispatch = createEventDispatcher();

  const fallbackTools = [
    { id: 'web_search', label: 'Web Search', description: '联网搜索获取最新信息', icon: 'globe', configured: true },
    { id: 'code_interpreter', label: 'Code Interpreter', description: '执行 Python 代码并返回结果', icon: 'inbox', configured: true },
    { id: 'image_generation', label: 'Image Generation', description: '根据文本描述生成图片', icon: 'eye', configured: false, unavailableReason: 'missing API key' },
    { id: 'file_analysis', label: 'File Analysis', description: '分析上传的文件内容', icon: 'file', configured: true }
  ];

  let loadError = '';
  $: tools = $availableTools.length > 0 ? $availableTools : fallbackTools;
  $: currentToolStates = $toolStatesStore;

  onMount(async () => {
    try {
      const data = await fetchTools();
      setAvailableTools(data.tools || []);
    } catch (error) {
      loadError = error.message;
      setAvailableTools(fallbackTools);
    }
  });

  function close() {
    dispatch('close');
  }

  function toggleTool(tool) {
    if (!tool.configured) return;
    const enabled = !currentToolStates[tool.id];
    setToolEnabled(tool.id, enabled);
    dispatch('change', { id: tool.id, enabled });
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      close();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div
    class="controls-backdrop"
    on:click={handleBackdropClick}
    on:keydown={handleKeydown}
    role="presentation"
  >
    <div
      class="controls-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="controls-title"
      tabindex="-1"
    >
      <header class="controls-header">
        <h2 id="controls-title" class="controls-title">{$t('controls.title')}</h2>
        <button
          type="button"
          class="close-btn"
          on:click={close}
          aria-label={$t('common.close')}
          title={$t('common.close')}
        >
          <Icon name="close" size="md" />
        </button>
      </header>

      <div class="controls-body">
        <p class="controls-hint">
          {$t('controls.hint')}
        </p>

        {#if loadError}
          <p class="controls-warning">{$t('controls.warning')}</p>
        {/if}

        <ul class="tool-list">
          {#each tools as tool (tool.id)}
            <li class="tool-item">
              <button
                type="button"
                class="tool-toggle"
                class:enabled={currentToolStates[tool.id]}
                class:disabled={!tool.configured}
                on:click={() => toggleTool(tool)}
                aria-pressed={currentToolStates[tool.id]}
                disabled={!tool.configured}
              >
                <span class="tool-icon" aria-hidden="true">
                  <Icon name={tool.icon} size="md" />
                </span>
                <span class="tool-info">
                  <span class="tool-label">
                    {tool.label}
                    {#if !tool.configured}
                      <span class="tool-badge">{$t('controls.unconfigured')}</span>
                    {/if}
                  </span>
                  <span class="tool-desc">
                    {tool.description}
                    {#if !tool.configured && tool.unavailableReason}
                      · {tool.unavailableReason}
                    {/if}
                  </span>
                </span>
                <span class="tool-switch" class:on={currentToolStates[tool.id]} aria-hidden="true">
                  <span class="switch-knob"></span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </div>
{/if}

<style>
  .controls-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 900;
    display: flex;
    justify-content: flex-end;
    animation: fadeIn 0.15s ease;
  }

  .controls-panel {
    width: 360px;
    max-width: 90vw;
    height: 100%;
    background: var(--bg-panel);
    border-left: 1px solid var(--border);
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    animation: slideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .controls-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }

  .controls-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .close-btn:focus-visible {
    outline: 2px solid var(--amber);
    outline-offset: 1px;
  }

  .controls-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .controls-hint {
    margin: 0 0 16px;
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.5;
  }

  .controls-warning {
    margin: -8px 0 16px;
    font-size: 12px;
    color: var(--warning, #f59e0b);
  }

  .tool-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .tool-toggle {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
    color: var(--text-primary);
    font-family: inherit;
  }

  .tool-toggle:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--border-hover);
  }

  .tool-toggle:disabled {
    opacity: 0.62;
    cursor: not-allowed;
  }

  .tool-toggle.enabled {
    border-color: var(--amber, #f59e0b);
    background: rgba(245, 158, 11, 0.06);
  }

  .tool-toggle:focus-visible {
    outline: 2px solid var(--amber);
    outline-offset: 1px;
  }

  .tool-icon {
    color: var(--text-secondary);
    flex-shrink: 0;
    display: inline-flex;
  }

  .tool-toggle.enabled .tool-icon {
    color: var(--amber, #f59e0b);
  }

  .tool-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tool-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .tool-badge {
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 500;
  }

  .tool-desc {
    font-size: 11px;
    color: var(--text-dim);
    line-height: 1.4;
  }

  .tool-switch {
    position: relative;
    width: 32px;
    height: 18px;
    background: var(--border);
    border-radius: 9px;
    flex-shrink: 0;
    transition: background 0.2s;
  }

  .tool-switch.on {
    background: var(--amber, #f59e0b);
  }

  .switch-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .tool-switch.on .switch-knob {
    transform: translateX(14px);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideIn {
    from { transform: translateX(20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
</style>
