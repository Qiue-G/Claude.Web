<script>
  let deferredPrompt = $state(null);
  let showBanner = $state(false);

  // Listen for the beforeinstallprompt event
  $effect(() => {
    function handler(e) {
      e.preventDefault();
      deferredPrompt = e;
      showBanner = true;
    }

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  });

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      console.log('[PWA] User accepted install');
    }
    deferredPrompt = null;
    showBanner = false;
  }

  function handleDismiss() {
    showBanner = false;
    deferredPrompt = null;
  }
</script>

{#if showBanner}
  <div class="install-banner" role="alert">
    <div class="install-info">
      <span class="install-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </span>
      <span class="install-text">安装 Free Code 到主屏幕</span>
    </div>
    <div class="install-actions">
      <button class="install-btn" onclick={handleInstall}>安装</button>
      <button class="dismiss-btn" onclick={handleDismiss}>稍后</button>
    </div>
  </div>
{/if}

<style>
  .install-banner {
    position: fixed;
    bottom: 64px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 300;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    max-width: 360px;
    width: calc(100% - 32px);
  }

  .install-info {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }

  .install-icon {
    display: flex;
    align-items: center;
    color: var(--amber);
  }

  .install-text {
    font-size: 13px;
    color: var(--text-primary);
    font-weight: 500;
  }

  .install-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .install-btn {
    padding: 6px 14px;
    background: var(--amber);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    min-height: 32px;
    transition: background 0.15s;
  }

  .install-btn:hover {
    background: var(--amber-bright);
  }

  .dismiss-btn {
    padding: 6px 10px;
    background: transparent;
    color: var(--text-muted);
    border: none;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    min-height: 32px;
    transition: all 0.15s;
  }

  .dismiss-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
</style>
