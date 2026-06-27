<script>
  import { onMount, onDestroy, tick, createEventDispatcher } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { modelParameters, resetParameters } from '$stores/modelParameters.store.js';
  import Icon from '$components/common/Icon.svelte';
  import Tooltip from '$components/common/Tooltip.svelte';
  import { t } from '$lib/i18n.js';

  export let show = false;
  export let onClose = () => {};
  const dispatch = createEventDispatcher();

  // 内部状态：父组件通过 show 控制显示，子组件通过 dispatch + onClose 通知关闭
  let visible = false;
  $: visible = show;

  let drawerEl;
  let panelEl;
  let panelHeight = 460; // 可拖拽调整的高度

  function close() {
    dispatch('close');
    onClose();
  }

  // ESC 关闭
  function handleKeydown(e) {
    if (e.key === 'Escape' && show) {
      e.stopPropagation();
      close();
    }
    // 焦点陷阱：Tab/Shift+Tab 循环
    if (e.key === 'Tab' && show && panelEl) {
      const focusable = panelEl.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // 点击遮罩关闭（点击 backdrop 自身时关闭，冒泡到 panel 不关闭）
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  $: if (typeof document !== 'undefined') {
    if (visible) {
      document.body.style.overflow = 'hidden';
      // 焦点陷阱
      tick().then(() => {
        if (panelEl) {
          const focusable = panelEl.querySelector(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          focusable?.focus();
        }
      });
    } else {
      document.body.style.overflow = '';
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('mousemove', doResize);
    window.addEventListener('mouseup', stopResize);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('mousemove', doResize);
      window.removeEventListener('mouseup', stopResize);
    };
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('mousemove', doResize);
      window.removeEventListener('mouseup', stopResize);
      document.body.style.overflow = '';
    }
  });

  function handleReset() {
    resetParameters();
  }

  function handleSliderChange(param, value) {
    modelParameters.update(params => ({
      ...params,
      [param]: parseFloat(value)
    }));
  }

  function handleNumberChange(param, value) {
    const num = parseInt(value);
    if (!isNaN(num) && num >= 0) {
      modelParameters.update(params => ({
        ...params,
        [param]: num
      }));
    }
  }

  function handleSeedChange(value) {
    const trimmed = value.trim();
    modelParameters.update(params => ({
      ...params,
      seed: trimmed === '' ? null : (isNaN(parseInt(trimmed)) ? trimmed : parseInt(trimmed))
    }));
  }

  function handleStopChange(value) {
    modelParameters.update(params => ({
      ...params,
      stop: value
    }));
  }

  function handleStreamToggle() {
    modelParameters.update(params => ({
      ...params,
      stream: !params.stream
    }));
  }

  // 拖拽调整高度
  let resizing = false;
  let startY = 0;
  let startHeight = 0;

  function startResize(e) {
    resizing = true;
    startY = e.clientY;
    startHeight = panelHeight;
    e.preventDefault();
  }

  function doResize(e) {
    if (!resizing) return;
    const delta = startY - e.clientY;
    const newHeight = Math.max(300, Math.min(window.innerHeight - 100, startHeight + delta));
    panelHeight = newHeight;
  }

  function stopResize() {
    resizing = false;
  }
</script>

{#if visible}
  <div
    bind:this={drawerEl}
    class="drawer-backdrop"
    on:mousedown={handleBackdropClick}
    transition:fade={{ duration: 120 }}
    role="presentation"
  >
    <div
      bind:this={panelEl}
      class="drawer-panel"
      class:resizing
      on:mousedown={(e) => e.stopPropagation()}
      transition:fly={{ y: 400, duration: 180 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="params-drawer-title"
      tabindex="-1"
      style="height: {panelHeight}px;"
    >
      <button
        class="resizer-handle"
        aria-label="拖动调整高度"
        title="拖动调整高度"
        on:mousedown={startResize}
        type="button"
      >
        <div class="grip"></div>
      </button>

      <div class="drawer-header">
        <h3 id="params-drawer-title">{$t('model.parameters')}</h3>
        <button class="close-btn" on:click={close} aria-label={$t('common.close')}>
          <Icon name="x" size="md" />
        </button>
      </div>

      <div class="drawer-content" style="max-height: {panelHeight - 110}px;">
        <!-- Temperature -->
        <div class="param-group">
          <div class="param-label">
            <Tooltip content={$t('model.temperatureDesc')} placement="right">
              <label for="param-temperature">
                {$t('model.temperature')}
                <Icon name="info" size="sm" className="info-icon" />
              </label>
            </Tooltip>
            <span class="param-value">{$modelParameters.temperature}</span>
          </div>
          <input
            id="param-temperature"
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={$modelParameters.temperature}
            on:input={(e) => handleSliderChange('temperature', e.target.value)}
            class="param-slider"
          />
        </div>

        <!-- Top P -->
        <div class="param-group">
          <div class="param-label">
            <Tooltip content={$t('model.topPDesc')} placement="right">
              <label for="param-topP">
                {$t('model.topP')}
                <Icon name="info" size="sm" className="info-icon" />
              </label>
            </Tooltip>
            <span class="param-value">{$modelParameters.topP}</span>
          </div>
          <input
            id="param-topP"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={$modelParameters.topP}
            on:input={(e) => handleSliderChange('topP', e.target.value)}
            class="param-slider"
          />
        </div>

        <!-- Top K -->
        <div class="param-group">
          <div class="param-label">
            <Tooltip content={$t('model.topKDesc')} placement="right">
              <label for="param-topK">
                {$t('model.topK')}
                <Icon name="info" size="sm" className="info-icon" />
              </label>
            </Tooltip>
            <span class="param-value">{$modelParameters.topK}</span>
          </div>
          <input
            id="param-topK"
            type="range"
            min="1"
            max="100"
            step="1"
            value={$modelParameters.topK}
            on:input={(e) => handleSliderChange('topK', e.target.value)}
            class="param-slider"
          />
        </div>

        <!-- Max Tokens -->
        <div class="param-group">
          <div class="param-label">
            <Tooltip content={$t('model.maxTokensDesc')} placement="right">
              <label for="param-maxTokens">
                {$t('model.maxTokens')}
                <Icon name="info" size="sm" className="info-icon" />
              </label>
            </Tooltip>
          </div>
          <input
            id="param-maxTokens"
            type="number"
            min="1"
            max="128000"
            value={$modelParameters.maxTokens}
            on:input={(e) => handleNumberChange('maxTokens', e.target.value)}
            class="param-input"
          />
        </div>

        <!-- Frequency Penalty -->
        <div class="param-group">
          <div class="param-label">
            <Tooltip content={$t('model.frequencyPenaltyDesc')} placement="right">
              <label for="param-frequencyPenalty">
                {$t('model.frequencyPenalty')}
                <Icon name="info" size="sm" className="info-icon" />
              </label>
            </Tooltip>
            <span class="param-value">{$modelParameters.frequencyPenalty}</span>
          </div>
          <input
            id="param-frequencyPenalty"
            type="range"
            min="-2"
            max="2"
            step="0.1"
            value={$modelParameters.frequencyPenalty}
            on:input={(e) => handleSliderChange('frequencyPenalty', e.target.value)}
            class="param-slider"
          />
        </div>

        <!-- Presence Penalty -->
        <div class="param-group">
          <div class="param-label">
            <Tooltip content={$t('model.presencePenaltyDesc')} placement="right">
              <label for="param-presencePenalty">
                {$t('model.presencePenalty')}
                <Icon name="info" size="sm" className="info-icon" />
              </label>
            </Tooltip>
            <span class="param-value">{$modelParameters.presencePenalty}</span>
          </div>
          <input
            id="param-presencePenalty"
            type="range"
            min="-2"
            max="2"
            step="0.1"
            value={$modelParameters.presencePenalty}
            on:input={(e) => handleSliderChange('presencePenalty', e.target.value)}
            class="param-slider"
          />
        </div>

        <!-- Seed -->
        <div class="param-group">
          <div class="param-label">
            <Tooltip content={$t('model.seedDesc')} placement="right">
              <label for="param-seed">
                {$t('model.seed')}
                <Icon name="info" size="sm" className="info-icon" />
              </label>
            </Tooltip>
          </div>
          <input
            id="param-seed"
            type="text"
            value={$modelParameters.seed ?? ''}
            placeholder={$t('model.seed') + '...'}
            on:input={(e) => handleSeedChange(e.target.value)}
            class="param-input param-input-text"
          />
        </div>

        <!-- Stop -->
        <div class="param-group">
          <div class="param-label">
            <Tooltip content={$t('model.stopDesc')} placement="right">
              <label for="param-stop">
                {$t('model.stop')}
                <Icon name="info" size="sm" className="info-icon" />
              </label>
            </Tooltip>
          </div>
          <input
            id="param-stop"
            type="text"
            value={$modelParameters.stop ?? ''}
            placeholder="\n, ###"
            on:input={(e) => handleStopChange(e.target.value)}
            class="param-input param-input-text"
          />
        </div>

        <!-- Stream -->
        <div class="param-group param-group-row">
          <div class="param-label">
            <Tooltip content={$t('model.streamDesc')} placement="right">
              <label for="param-stream">
                {$t('model.stream')}
                <Icon name="info" size="sm" className="info-icon" />
              </label>
            </Tooltip>
          </div>
          <button
            id="param-stream"
            class="toggle-switch"
            class:on={$modelParameters.stream}
            on:click={handleStreamToggle}
            aria-pressed={$modelParameters.stream}
            aria-label={$t('model.stream')}
            type="button"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>
      </div>

      <div class="drawer-footer">
        <button class="reset-btn" on:click={handleReset}>
          <Icon name="refresh" size="sm" />
          {$t('model.resetParams')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 999;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .drawer-panel {
    width: 100%;
    max-width: 720px;
    background: var(--bg-secondary, #1e1e1e);
    color: var(--text-primary, #e5e5e5);
    border-top-left-radius: 16px;
    border-top-right-radius: 16px;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .drawer-panel.resizing {
    transition: none;
    user-select: none;
  }

  .resizer-handle {
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: ns-resize;
    user-select: none;
    flex-shrink: 0;
    background: transparent;
    border: none;
    width: 100%;
    padding: 0;
  }

  .resizer-handle:focus {
    outline: none;
  }

  .resizer-handle:focus-visible .grip {
    background: var(--accent-color, #f59e0b);
    box-shadow: 0 0 0 2px var(--accent-color, #f59e0b);
  }

  .resizer-handle .grip {
    width: 40px;
    height: 4px;
    background: var(--border-color, #404040);
    border-radius: 2px;
  }

  .resizer-handle:hover .grip {
    background: var(--accent-color, #f59e0b);
  }

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px 12px;
    border-bottom: 1px solid var(--border-color, #404040);
    flex-shrink: 0;
  }

  .drawer-header h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-secondary, #9ca3af);
    cursor: pointer;
  }

  .close-btn:hover {
    background: var(--bg-tertiary, #2a2a2a);
    color: var(--text-primary, #e5e5e5);
  }

  .drawer-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 24px;
  }

  .param-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .param-group-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .param-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary, #9ca3af);
  }

  .param-label label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: help;
  }

  :global(.info-icon) {
    color: var(--text-secondary, #6b7280);
    opacity: 0.7;
  }

  .param-value {
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: var(--accent-color, #f59e0b);
    background: var(--bg-tertiary, #2a2a2a);
    padding: 1px 6px;
    border-radius: 3px;
  }

  .param-slider {
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: var(--bg-tertiary, #2a2a2a);
    outline: none;
    -webkit-appearance: none;
    appearance: none;
  }

  .param-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent-color, #f59e0b);
    cursor: pointer;
  }

  .param-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent-color, #f59e0b);
    cursor: pointer;
    border: none;
  }

  .param-input {
    background: var(--bg-tertiary, #2a2a2a);
    border: 1px solid var(--border-color, #404040);
    border-radius: 4px;
    color: var(--text-primary, #e5e5e5);
    padding: 5px 8px;
    font-family: 'Courier New', monospace;
    font-size: 12px;
  }

  .param-input-text {
    width: 100%;
  }

  .param-input:focus {
    outline: none;
    border-color: var(--accent-color, #f59e0b);
  }

  .toggle-switch {
    position: relative;
    width: 36px;
    height: 20px;
    background: var(--bg-tertiary, #2a2a2a);
    border: 1px solid var(--border-color, #404040);
    border-radius: 10px;
    cursor: pointer;
    padding: 0;
    transition: background 0.2s;
  }

  .toggle-switch.on {
    background: var(--accent-color, #f59e0b);
    border-color: var(--accent-color, #f59e0b);
  }

  .toggle-knob {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 16px;
    height: 16px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.2s;
  }

  .toggle-switch.on .toggle-knob {
    transform: translateX(16px);
  }

  .drawer-footer {
    padding: 12px 20px;
    border-top: 1px solid var(--border-color, #404040);
    flex-shrink: 0;
  }

  .reset-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 8px;
    background: var(--bg-tertiary, #2a2a2a);
    border: 1px solid var(--border-color, #404040);
    border-radius: 6px;
    color: var(--text-primary, #e5e5e5);
    cursor: pointer;
    font-size: 12px;
  }

  .reset-btn:hover {
    background: var(--bg-raised, #262626);
    border-color: var(--accent-color, #f59e0b);
  }
</style>
