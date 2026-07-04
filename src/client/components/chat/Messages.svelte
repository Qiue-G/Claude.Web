<script>
  import ChatMessage from './ChatMessage.svelte';
  import Placeholder from './Placeholder.svelte';
  import { isWaiting } from '$stores/chat.store.js';

  export let messages = [];
  export let emptyTitle = '';
  export let emptySubtitle = '';
  export let suggestions = [];
  export let onsuggestion = null;
  export let onedit = null;
  export let onretry = null;
  export let onrate = null;
  export let ondelete = null;
  export let sessionId = '';

  let messagesContainer;
  let userScrolledUp = false;

  function handleScroll() {
    const container = messagesContainer;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    userScrolledUp = scrollHeight - scrollTop - clientHeight > 80;
  }

  $: {
    const container = messagesContainer;
    if (container && !userScrolledUp) {
      queueMicrotask(() => {
        container.scrollTop = container.scrollHeight;
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      });
    }
  }
</script>

<div bind:this={messagesContainer} class="messages-container" onscroll={handleScroll}>
  {#if messages.length === 0}
    <Placeholder title={emptyTitle || 'Welcome'} subtitle={emptySubtitle || 'AI-powered coding assistant'} icon="⚙" {suggestions} on:suggestion={(e) => onsuggestion?.(e.detail)} />
  {:else}
    <div class="messages-list">
      {#each messages as msg, i (msg.id)}
        <ChatMessage role={msg.role} content={msg.content} time={msg.time} messageId={msg.id} files={msg.files} streaming={i === messages.length - 1 && msg.role === 'assistant' && $isWaiting} rating={msg.rating} {sessionId} {onedit} {onretry} {onrate} {ondelete} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .messages-container { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 16px 0; }
  .messages-list { display: flex; flex-direction: column; gap: 4px; }
</style>
