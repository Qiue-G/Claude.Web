<script>
  import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';

  export let items = [];
  export let x = 0;
  export let y = 0;
  export let open = false;
  /** @type {number} 距离视口边缘的最小间距 */
  export let edgePadding = 8;
  /** @type {number} 菜单的预估高度（用于边界检测） */
  export let estimatedHeight = 300;
  /** @type {number} 菜单的预估宽度 */
  export let estimatedWidth = 200;

  const dispatch = createEventDispatcher();

  let menuEl;
  let adjustedX = x;
  let adjustedY = y;
  let menuWidth = estimatedWidth;
  let menuHeight = estimatedHeight;

  // 当 open 变为 true 或 x/y 变化时，计算边界
  $: if (open) {
    adjustedX = x;
    adjustedY = y;
    tick().then(() => calculateBounds());
  }

  function calculateBounds() {
    if (!menuEl || typeof window === 'undefined') return;

    // 获取实际尺寸
    const rect = menuEl.getBoundingClientRect();
    menuWidth = rect.width || estimatedWidth;
    menuHeight = rect.height || estimatedHeight;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 水平边界
    let newX = x;
    if (x + menuWidth + edgePadding > viewportWidth) {
      // 超出右边界，菜单向左展开
      newX = Math.max(edgePadding, x - menuWidth);
    }
    if (newX < edgePadding) {
      newX = edgePadding;
    }

    // 垂直边界
    let newY = y;
    if (y + menuHeight + edgePadding > viewportHeight) {
      // 超出下边界，菜单向上展开
      newY = Math.max(edgePadding, y - menuHeight);
    }
    if (newY < edgePadding) {
      newY = edgePadding;
    }

    adjustedX = newX;
    adjustedY = newY;
  }

  function handleClick(item) {
    if (item.disabled) return;
    dispatch('select', item);
    open = false;
  }

  function handleOutsideClick(e) {
    if (open && menuEl && !menuEl.contains(e.target)) {
      open = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      open = false;
    }
  }

  // 窗口大小变化时重新计算边界
  function handleResize() {
    if (open) {
      calculateBounds();
    }
  }

  onMount(() => {
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    }
  });
</script>

<svelte:window on:click={handleOutsideClick} on:keydown={handleKeydown} />

{#if open}
  <div
    bind:this={menuEl}
    class="context-menu"
    style="left: {adjustedX}px; top: {adjustedY}px;"
    role="menu"
    on:click|stopPropagation
    on:keydown|stopPropagation
  >
    {#each items as item, index (item.id || index)}
      {#if item.separator}
        <div class="context-sep" role="separator"></div>
      {:else}
        <div
          class="context-item"
          class:disabled={item.disabled}
          role="menuitem"
          tabindex={item.disabled ? -1 : 0}
          on:click={() => handleClick(item)}
          on:keydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleClick(item);
            }
          }}
        >
          <span class="ci-icon" aria-hidden="true">{item.icon || ''}</span>
          <span class="ci-label">{item.label}</span>
          {#if item.shortcut}
            <span class="ci-shortcut">{item.shortcut}</span>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    min-width: 180px;
    max-width: 320px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px;
    z-index: 500;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    animation: ctxFadeIn 0.1s ease;
    user-select: none;
  }

  .context-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
    transition: background 0.15s ease;
    outline: none;
  }

  .context-item:hover:not(.disabled) {
    background: var(--bg-accent-dim2);
    color: var(--text-primary);
  }

  .context-item:focus-visible:not(.disabled) {
    background: var(--bg-accent-dim2);
    color: var(--text-primary);
    outline: 1px solid var(--amber, #f59e0b);
  }

  .context-item.disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .ci-icon {
    width: 18px;
    text-align: center;
    font-size: 14px;
    flex-shrink: 0;
  }

  .ci-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ci-shortcut {
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .context-sep {
    height: 1px;
    background: var(--border);
    margin: 4px 8px;
  }

  @keyframes ctxFadeIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
