<script>
  import { createEventDispatcher } from 'svelte';
  import ChatMessage from './ChatMessage.svelte';
  import Placeholder from './Placeholder.svelte';
  import { isWaiting } from '$stores/chat.store.js';

  let {
    messages = [],
    emptyTitle = '',
    emptySubtitle = '',
    suggestions = []
  } = $props();

  const dispatch = createEventDispatcher();

  let messagesContainer;
  let userScrolledUp = $state(false);

  function handleScroll() {
    const container = messagesContainer;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    userScrolledUp = scrollHeight - scrollTop - clientHeight > 80;
  }

  $effect(() => {
    const container = messagesContainer;
    if (!container) return;
    if (!userScrolledUp) {
      queueMicrotask(() => {
        container.scrollTop = container.scrollHeight;
        // 二次滚动确保 content-visibility 布局完成
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      });
    }
  });
</script>

<div bind:this={messagesContainer} class="messages-container" onscroll={handleScroll}>
  {#if messages.length === 0}
    <Placeholder title={emptyTitle || 'Welcome'} subtitle={emptySubtitle || 'AI-powered coding assistant'} icon="⚙" {suggestions} on:suggestion={(e) => dispatch('suggestion', e.detail)} />
  {:else}
    <div class="messages-list">
      {#each messages as msg, i (msg.id)}
        <ChatMessage role={msg.role} content={msg.content} time={msg.time} messageId={msg.id} streaming={i === messages.length - 1 && msg.role === 'assistant' && $isWaiting} rating={msg.rating} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .messages-container { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 16px 0; }
  .messages-list { display: flex; flex-direction: column; gap: 4px; }
</style>
