<script>
  import { toasts, dismissToast, removeToast } from '$stores/toast.store.js';
  import Icon from '$components/common/Icon.svelte';

  const icons = {
    success: 'check',
    error: 'close',
    warning: 'warning',
    info: 'info'
  };

  function handleClose(id) {
    dismissToast(id);
  }
</script>

<div class="toast-container">
  {#each $toasts as toast (toast.id)}
    <div
      class="toast toast-{toast.type}"
      class:dismissing={toast.dismissing}
      role="alert"
    >
      <div class="toast-icon">
        <Icon name={icons[toast.type]} size="sm" />
      </div>
      <div class="toast-content">{toast.message}</div>
      <button class="toast-close" on:click={() => handleClose(toast.id)} aria-label="close">
        <Icon name="close" size="sm" />
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: 60px;
    right: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 400px;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.25s ease-out;
    transition: opacity 0.2s ease, transform 0.2s ease;
  }

  .toast.dismissing {
    animation: slideOut 0.2s ease-in forwards;
  }

  .toast-success {
    border-color: var(--green);
  }

  .toast-success .toast-icon {
    color: var(--green);
  }

  .toast-error {
    border-color: var(--red);
  }

  .toast-error .toast-icon {
    color: var(--red);
  }

  .toast-warning {
    border-color: var(--amber);
  }

  .toast-warning .toast-icon {
    color: var(--amber);
  }

  .toast-info {
    border-color: var(--blue);
  }

  .toast-info .toast-icon {
    color: var(--blue);
  }

  .toast-icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .toast-content {
    flex: 1;
    font-size: 14px;
    color: var(--text-primary);
    line-height: 1.4;
  }

  .toast-close {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .toast-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
      max-height: 200px;
      margin-bottom: 8px;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
      max-height: 0;
      margin-bottom: 0;
      padding-top: 0;
      padding-bottom: 0;
      border-width: 0;
    }
  }
</style>
