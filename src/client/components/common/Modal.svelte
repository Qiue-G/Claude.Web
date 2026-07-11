<script>
  import { tick, onDestroy } from 'svelte';
  import { fly, fade } from 'svelte/transition';

  export let open = false;
  export let title = '';
  export let width = '500px';
  /** @type {boolean} 是否锁定 body 滚动 */
  export let lockScroll = true;
  /** @type {boolean} 是否启用焦点陷阱 */
  export let trapFocus = true;
  /** @type {boolean} 点击遮罩是否关闭 */
  export let closeOnBackdrop = true;
  /** @type {Function} */
  export let onclose = undefined;

  let modalEl;
  let modalContent;
  let previousActiveElement = null;
  let originalBodyOverflow = '';
  let originalBodyPaddingRight = '';
  let mousedownOnBackdrop = false;

  $: if (open) {
    tick().then(() => setupModal());
  } else {
    teardownModal();
  }

  function setupModal() {
    // 保存当前焦点元素
    previousActiveElement = document.activeElement;

    // 锁定 body 滚动
    if (lockScroll && typeof document !== 'undefined') {
      // 计算滚动条宽度，避免布局抖动
      const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
      originalBodyOverflow = document.body.style.overflow;
      originalBodyPaddingRight = document.body.style.paddingRight;

      document.body.style.overflow = 'hidden';
      if (scrollBarWidth > 0) {
        document.body.style.paddingRight = `${scrollBarWidth}px`;
      }
    }

    // 设置初始焦点
    if (trapFocus) {
      tick().then(() => {
        if (modalContent) {
          const focusable = getFocusableElements(modalContent);
          if (focusable.length > 0) {
            focusable[0].focus();
          } else {
            modalContent.focus();
          }
        }
      });
    }
  }

  function teardownModal() {
    // 恢复 body 滚动
    if (typeof document !== 'undefined') {
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.paddingRight = originalBodyPaddingRight;
    }

    // 恢复焦点
    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus();
    }
  }

  function getFocusableElements(container) {
    if (!container) return [];
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"]):not([disabled])'
    ].join(',');
    return Array.from(container.querySelectorAll(selector));
  }

  function handleClose() {
    open = false;
    onclose?.();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      // 焦点在输入框时不关闭弹窗，避免误触
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.stopPropagation();
      handleClose();
      return;
    }

    // 焦点陷阱：Tab 键循环
    if (trapFocus && e.key === 'Tab' && modalContent) {
      const focusable = getFocusableElements(modalContent);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (e.shiftKey) {
        // Shift+Tab：从第一个回到最后一个
        if (activeElement === firstFocusable || !modalContent.contains(activeElement)) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else {
        // Tab：从最后一个跳到第一个
        if (activeElement === lastFocusable || !modalContent.contains(activeElement)) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    }
  }

  function handleBackdropMouseDown(e) {
    // 只有 mousedown 和 mouseup 都在遮罩上时才关闭
    if (e.target === e.currentTarget) {
      mousedownOnBackdrop = true;
    }
  }

  function handleBackdropMouseUp(e) {
    if (closeOnBackdrop && mousedownOnBackdrop && e.target === e.currentTarget) {
      handleClose();
    }
    mousedownOnBackdrop = false;
  }

  // 组件销毁时清理
  onDestroy(() => {
    if (open) {
      teardownModal();
    }
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div
    bind:this={modalEl}
    class="modal-overlay"
    role="presentation"
    onmousedown={handleBackdropMouseDown}
    onmouseup={handleBackdropMouseUp}
    transition:fade={{ duration: 150 }}
  >
    <div
      bind:this={modalContent}
      class="modal-content"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
      tabindex="-1"
      style="max-width: {width}"
      transition:fly={{ y: 20, duration: 200 }}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      {#if title}
        <div class="modal-header">
          <h3 id="modal-title" class="modal-title">{title}</h3>
          <button
            type="button"
            class="modal-close"
            onclick={handleClose}
            aria-label="close modal"
          >
            &times;
          </button>
        </div>
      {/if}
      <div class="modal-body">
        <slot />
      </div>
      {#if $$slots.footer}
        <div class="modal-footer">
          <slot name="footer" />
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 90%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    outline: none;
  }

  .modal-content:focus {
    outline: none;
  }

  .modal-content:focus-visible {
    outline: 2px solid var(--amber, #f59e0b);
    outline-offset: -2px;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .modal-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 20px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    line-height: 1;
  }

  .modal-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .modal-close:focus-visible {
    outline: 2px solid var(--amber, #f59e0b);
    outline-offset: 1px;
  }

  .modal-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .modal-footer {
    padding: 12px 20px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
