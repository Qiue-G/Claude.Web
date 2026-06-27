<script>
  import { fly } from 'svelte/transition';

  export let content = '';
  export let placement = 'top'; // top, bottom, left, right
  export let className = '';

  let show = false;
  let timer;

  function showTooltip() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      show = true;
    }, 300);
  }

  function hideTooltip() {
    clearTimeout(timer);
    show = false;
  }
</script>

<span
  class="tooltip-wrapper {className}"
  on:mouseenter={showTooltip}
  on:mouseleave={hideTooltip}
  on:focusin={showTooltip}
  on:focusout={hideTooltip}
  role="presentation"
>
  <slot />
  {#if show && content}
    <span
      class="tooltip tooltip-{placement}"
      role="tooltip"
      transition:fly={{ y: placement === 'top' ? 4 : -4, duration: 120 }}
    >
      {content}
    </span>
  {/if}
</span>

<style>
  .tooltip-wrapper {
    position: relative;
    display: inline-flex;
  }

  .tooltip {
    position: absolute;
    background: #1f2937;
    color: #f9fafb;
    font-size: 12px;
    line-height: 1.4;
    padding: 6px 10px;
    border-radius: 6px;
    white-space: normal;
    max-width: 260px;
    min-width: 80px;
    width: max-content;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    pointer-events: none;
  }

  .tooltip-top {
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
  }

  .tooltip-bottom {
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
  }

  .tooltip-left {
    right: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
  }

  .tooltip-right {
    left: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
  }
</style>
