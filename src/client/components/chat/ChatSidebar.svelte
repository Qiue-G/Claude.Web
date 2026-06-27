<script>
  import { sessions, currentSessionId, createSession, switchSession, deleteSession, updateSessionTitle } from '$stores/chatHistory.store.js';
  import Icon from '$components/common/Icon.svelte';
  import { createEventDispatcher } from 'svelte';
  import { t } from '$lib/i18n.js';

  const dispatch = createEventDispatcher();

  let editingId = null;
  let editTitle = '';
  let searchQuery = '';

  let filteredSessions = [];
  let searchResults = []; // { sessionId, matchTitle, matchContent }

  $: {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const results = [];
      const seen = new Set();

      $sessions.forEach(session => {
        // 搜索标题
        if (session.title.toLowerCase().includes(q)) {
          if (!seen.has(session.id)) {
            results.push({ sessionId: session.id, matchTitle: session.title, matchContent: '' });
            seen.add(session.id);
          }
        }
        // 搜索消息内容
        (session.messages || []).forEach(msg => {
          if (msg.content && msg.content.toLowerCase().includes(q)) {
            if (!seen.has(session.id)) {
              const snippet = msg.content.length > 80
                ? msg.content.substring(0, 80) + '...'
                : msg.content;
              results.push({ sessionId: session.id, matchTitle: session.title, matchContent: snippet });
              seen.add(session.id);
            }
          }
        });
      });

      searchResults = results;
      filteredSessions = $sessions.filter(s => seen.has(s.id));
    } else {
      searchResults = [];
      filteredSessions = $sessions;
    }
  }

  function highlightText(text, query) {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  function handleNewChat() {
    const session = createSession();
    dispatch('newchat', session);
    searchQuery = '';
  }

  function handleSelectSession(session) {
    switchSession(session.id);
    dispatch('select', session);
    searchQuery = '';
  }

  function handleDeleteSession(e, session) {
    e.stopPropagation();
    if (confirm(`${$t('chat.confirmDeleteSession')} "${session.title}" ?`)) {
      deleteSession(session.id);
    }
  }

  function startEditing(session) {
    editingId = session.id;
    editTitle = session.title;
  }

  function saveEdit() {
    if (editTitle.trim()) {
      updateSessionTitle(editingId, editTitle.trim());
    }
    editingId = null;
    editTitle = '';
  }

  function cancelEdit() {
    editingId = null;
    editTitle = '';
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (diff < 60000) return $t('time.justNow');
    if (diff < 3600000) return minutes === 1 ? $t('time.minuteAgo') : $t('time.minutesAgo').replace('{n}', minutes);
    if (diff < 86400000) return hours === 1 ? $t('time.hourAgo') : $t('time.hoursAgo').replace('{n}', hours);
    if (diff < 604800000) return days === 1 ? $t('time.dayAgo') : $t('time.daysAgo').replace('{n}', days);

    return date.toLocaleDateString();
  }
</script>

<div class="chat-sidebar">
  <div class="sidebar-header">
    <button class="new-chat-btn" on:click={handleNewChat}>
      <Icon name="edit" size="md" />
      <span>{$t('chat.new')}</span>
    </button>
  </div>

  <div class="search-box">
    <Icon name="search" size="sm" />
    <input type="text" class="search-input" placeholder={$t('common.search') + '...'} bind:value={searchQuery} />
    {#if searchQuery}
      <button class="search-clear" on:click={() => searchQuery = ''}><Icon name="close" size="sm" /></button>
    {/if}
  </div>

  <div class="session-list">
    {#if searchQuery.trim()}
      <div class="search-results-header">
        <span>搜索 "<strong>{searchQuery}</strong>"</span>
        <span class="search-count">找到 {searchResults.length} 个</span>
      </div>
    {/if}

    {#each filteredSessions as session (session.id)}
      <div 
        class="session-item" 
        class:active={$currentSessionId === session.id}
        on:click={() => handleSelectSession(session)}
        on:keydown={(e) => e.key === 'Enter' && handleSelectSession(session)}
        role="button"
        tabindex="0"
      >
        {#if editingId === session.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input 
            type="text" 
            class="edit-input"
            bind:value={editTitle}
            on:blur={saveEdit}
            on:keydown={(e) => {
              if (e.key === 'Enter') saveEdit();
              if (e.key === 'Escape') cancelEdit();
            }}
            autofocus
          />
        {:else}
          <div class="session-content">
            <div class="session-title">{session.title}</div>
            <div class="session-time">{formatTime(session.updatedAt)}</div>
            {#if searchQuery.trim()}
              {@const result = searchResults.find(r => r.sessionId === session.id)}
              {#if result?.matchContent}
                <div class="search-match">{@html highlightText(result.matchContent, searchQuery)}</div>
              {/if}
            {/if}
          </div>
          <div class="session-actions">
            <button
              class="action-btn"
              on:click={(e) => { e.stopPropagation(); startEditing(session); }}
              title={$t('files.rename')}
            >
              <Icon name="edit" size="sm" />
            </button>
            <button
              class="action-btn danger"
              on:click={(e) => handleDeleteSession(e, session)}
              title={$t('files.delete')}
            >
              <Icon name="trash" size="sm" />
            </button>
          </div>
        {/if}
      </div>
    {/each}

    {#if $sessions.length === 0}
      <div class="empty-state">
        <p>{$t('chat.noMessages')}</p>
        <p class="hint">{$t('chat.startHint')}</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .chat-sidebar {
    width: 280px;
    background: var(--bg-raised);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .sidebar-header {
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }

  .new-chat-btn {
    width: 100%;
    padding: 10px 16px;
    background: var(--amber);
    color: white;
    border: none;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .new-chat-btn:hover {
    background: var(--amber-bright);
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    margin: 8px 12px 4px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
  }

  .search-input::placeholder { color: var(--text-dim); }

  .search-clear {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    border-radius: 3px;
  }

  .search-clear:hover { color: var(--text-primary); }

  .search-results-header {
    padding: 4px 12px 8px;
    font-size: 12px;
    color: var(--text-dim);
    display: flex;
    justify-content: space-between;
  }

  .search-count { color: var(--text-muted); }

  .search-match {
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.4;
  }

  .search-match :global(mark) {
    background: var(--amber);
    color: var(--bg-base);
    padding: 0 2px;
    border-radius: 2px;
  }

  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .session-item {
    padding: 12px;
    margin-bottom: 4px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .session-item:hover {
    background: var(--bg-hover);
  }

  .session-item.active {
    background: var(--bg-accent-dim);
    border: 1px solid var(--border-hover);
  }

  .session-content {
    flex: 1;
    min-width: 0;
  }

  .session-title {
    font-size: 14px;
    color: var(--text-primary);
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .session-time {
    font-size: 12px;
    color: var(--text-dim);
  }

  .session-actions {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .session-item:hover .session-actions {
    opacity: 1;
  }

  .action-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .action-btn.danger:hover {
    background: rgba(239, 68, 68, 0.1);
    color: var(--red);
  }

  .edit-input {
    flex: 1;
    padding: 6px 8px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 14px;
    font-family: inherit;
  }

  .edit-input:focus {
    outline: none;
    border-color: var(--border-hover);
  }

  .empty-state {
    padding: 32px 16px;
    text-align: center;
    color: var(--text-dim);
  }

  .empty-state p {
    margin: 0;
    font-size: 14px;
  }

  .empty-state .hint {
    margin-top: 8px;
    font-size: 12px;
  }
</style>
