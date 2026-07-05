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

  // 当前聚焦的 diff group index（用于键盘/按钮导航）
  let diffFocusMap = {};

  $: _t = $t;

  // 对连续 file_diff 消息进行分组
  $: groupedMessages = groupFileDiffs(messages);

  function groupFileDiffs(msgs) {
    const result = [];
    let diffGroup = [];

    for (const msg of msgs) {
      if (msg.meta?.type === 'file_diff') {
        diffGroup.push(msg);
      } else {
        if (diffGroup.length > 0) {
          result.push({ type: 'diff_group', diffs: diffGroup });
          diffGroup = [];
        }
        result.push(msg);
      }
    }

    if (diffGroup.length > 0) {
      result.push({ type: 'diff_group', diffs: diffGroup });
    }

    return result;
  }

  // 导航处理
  function handlePrev(groupId, current) {
    return () => {
      const group = document.querySelector(`[data-diff-group="${groupId}"]`);
      if (!group) return;
      const cards = group.querySelectorAll('.file-diff-card');
      if (current > 0) {
        cards[current - 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        cards[current - 1]?.querySelector('.diff-header')?.focus();
      }
    };
  }

  function handleNext(groupId, current, total) {
    return () => {
      const group = document.querySelector(`[data-diff-group="${groupId}"]`);
      if (!group) return;
      const cards = group.querySelectorAll('.file-diff-card');
      if (current < total - 1) {
        cards[current + 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        cards[current + 1]?.querySelector('.diff-header')?.focus();
      }
    };
  }

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
      {#each groupedMessages as entry, i (entry.id || entry.diffs?.[0]?.id || i)}
        {#if entry.type === 'diff_group'}
          <div class="diff-group" data-diff-group={i}>
            <div class="diff-group-header">
              <span class="diff-group-title">文件变更 ({entry.diffs.length} 个文件)</span>
            </div>
            {#each entry.diffs as diffMsg, j (diffMsg.id)}
              <FileDiffCard
                diff={diffMsg.meta}
                {sessionId}
                index={j}
                total={entry.diffs.length}
                onprev={handlePrev(i, j)}
                onnext={handleNext(i, j, entry.diffs.length)}
                on:reverted={() => window.dispatchEvent(new CustomEvent('files-changed'))}
                on:open={(e) => onopenfile?.(e.detail)}
              />
            {/each}
          </div>
        {:else}
          <ChatMessage
            role={entry.role}
            content={entry.content}
            time={entry.time}
            messageId={entry.id}
            files={entry.files}
            streaming={i === groupedMessages.length - 1 && entry.role === 'assistant' && $isWaiting}
            rating={entry.rating}
            {sessionId}
            {onedit}
            {onretry}
            {onrate}
            {ondelete}
          />
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .messages-container { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 16px 0; }
  .messages-list { display: flex; flex-direction: column; gap: 4px; }

  /* ===== Diff Group ===== */
  .diff-group {
    display: flex;
    flex-direction: column;
    padding: 0 16px;
    margin: 4px 0;
  }

  .diff-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px 2px;
  }

  .diff-group-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
</style>
