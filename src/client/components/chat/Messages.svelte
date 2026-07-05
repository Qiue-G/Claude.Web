<script>
  import ChatMessage from './ChatMessage.svelte';
  import FileDiffCard from './FileDiffCard.svelte';
  import Placeholder from './Placeholder.svelte';
  import { isWaiting } from '$stores/chat.store.js';
  import { loadMoreHistory } from '$lib/websocket.js';
  import { t } from '$lib/i18n.js';

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
  export let onopenfile = null;

  let messagesContainer;
  let userScrolledUp = false;
  let loadingMore = false;

  $: _t = $t;

  function handleScroll() {
    const container = messagesContainer;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    userScrolledUp = scrollHeight - scrollTop - clientHeight > 80;

    // 滚动到顶部时加载更多历史
    if (scrollTop < 40 && !loadingMore && window.__historyHasMore) {
      loadingMore = true;
      loadMoreHistory();
      setTimeout(() => { loadingMore = false; }, 1000);
    }
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
  {#if window.__historyHasMore}
    <div class="load-more-hint">{$t('chat.loadMore')}</div>
  {/if}
  {#if messages.length === 0}
    <Placeholder title={emptyTitle || 'Welcome'} subtitle={emptySubtitle || 'AI-powered coding assistant'} icon="⚙" {suggestions} on:suggestion={(e) => onsuggestion?.(e.detail)} />
  {:else}
    <div class="messages-list">
      {#each messages as msg, i (msg.id)}
        {#if msg.meta?.type === 'file_diff'}
          <div class="diff-message-wrapper">
            <FileDiffCard diff={msg.meta} {sessionId} on:reverted={() => window.dispatchEvent(new CustomEvent('files-changed'))} on:open={(e) => onopenfile?.(e.detail)} />
          </div>
        {:else}
          <ChatMessage role={msg.role} content={msg.content} time={msg.time} messageId={msg.id} files={msg.files} streaming={i === messages.length - 1 && msg.role === 'assistant' && $isWaiting} rating={msg.rating} {sessionId} {onedit} {onretry} {onrate} {ondelete} />
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .messages-container { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 16px 0; }
  .messages-list { display: flex; flex-direction: column; gap: 4px; }
  .diff-message-wrapper { padding: 0 16px; }
</style>
