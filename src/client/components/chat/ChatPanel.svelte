<script>
  import { messages, updateMessage, deleteMessage, deleteMessagesAfter } from '$stores/chat.store.js';
  import {
    currentSession,
    currentSessionId,
    createSession
  } from '$stores/chatHistory.store.js';
  import {
    paramsPanelOpen,
    controlsPanelOpen,
    toggleParamsPanel,
    closeParamsPanel,
    openControlsPanel,
    chatSidebarOpen,
    toggleChatSidebar
  } from '$stores/ui.store.js';
  import { t } from '$lib/i18n.js';

  $: _t = $t;

  import Navbar from './Navbar.svelte';
  import Messages from './Messages.svelte';
  import ChatInput from './ChatInput.svelte';
  import ModelParametersPanel from './ModelParametersPanel.svelte';
  import ChatControls from './ChatControls.svelte';

  export let onsend = null;
  export let onToggleSidebar = null;

  let editContent = '';
  let editingMessageId = null;

  // 覆盖 suggestions
  $: suggestions = [
    { text: _t('chat.suggestion1'), label: _t('chat.suggestion1'), icon: '⚛' },
    { text: _t('chat.suggestion2'), label: _t('chat.suggestion2'), icon: '📁' },
    { text: _t('chat.suggestion3'), label: _t('chat.suggestion3'), icon: '🐛' },
    { text: '/help', label: _t('chat.suggestion4'), icon: '❓' }
  ];

  function handleSend(e) {
    const detail = e.detail;
    const text = typeof detail === 'string' ? detail : detail.text;
    const files = typeof detail === 'object' ? (detail.files || []) : [];
    const images = typeof detail === 'object' ? (detail.images || []) : [];

    if ((!text || !text.trim()) && files.length === 0 && images.length === 0) return;

    // 如果是编辑模式，删除被编辑消息之后的所有消息
    if (editingMessageId) {
      deleteMessagesAfter(editingMessageId);
      editingMessageId = null;
    }

    onsend?.({ text: text.trim(), files, images });
  }

  function handleNewChat() { createSession(); }
  function handleSettings() { openControlsPanel(); }

  function handleEditMessage(e) {
    const { id, content } = e; // 注意：prop 回调直接传值，不是事件对象
    editContent = content;
    editingMessageId = id;
  }

  function handleRetryMessage(e) {
    const { id } = e; // 注意：prop 回调直接传值，不是事件对象
    if (!$currentSession) return;
    const msgs = $currentSession.messages || [];
    if (id) {
      for (let i = msgs.findIndex(m => m.id === id) - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') {
          const userMsgId = msgs[i].id;
          deleteMessagesAfter(userMsgId);
          onsend?.(msgs[i].content);
          break;
        }
      }
    }
  }

  function handleRateMessage(e) {
    const { id, rating } = e; // 注意：prop 回调直接传值，不是事件对象
    updateMessage(id, { rating });
  }

  function handleDeleteMessage(e) {
    const { id } = e; // 注意：prop 回调直接传值，不是事件对象
    deleteMessage(id);
  }
</script>

<div class="chat-area">
  <Navbar
    sidebarOpen={$chatSidebarOpen}
    on:toggleSidebar={onToggleSidebar || toggleChatSidebar}
    on:newchat={handleNewChat}
    on:settings={handleSettings}
  />

  <div class="chat-content">
    <Messages
      messages={$messages}
      {suggestions}
      sessionId={$currentSessionId}
      onedit={handleEditMessage}
      onretry={handleRetryMessage}
      onrate={handleRateMessage}
      ondelete={handleDeleteMessage}
      onsuggestion={(text) => onsend?.(text)}
    />

    <div class="input-area">
      <ModelParametersPanel
        show={$paramsPanelOpen}
        onClose={closeParamsPanel}
        on:close={closeParamsPanel}
      />
      <ChatControls
        open={$controlsPanelOpen}
        on:close={() => controlsPanelOpen.set(false)}
      />
      <ChatInput
        on:send={handleSend}
        on:toggleParams={toggleParamsPanel}
        paramsOpen={$paramsPanelOpen}
        {editContent}
        on:editSent={() => { editContent = ''; editingMessageId = null; }}
      />
    </div>
  </div>
</div>

<style>
  .chat-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    background: var(--bg-base);
  }

  .chat-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .input-area {
    border-top: 1px solid var(--border);
    background: var(--bg-raised);
    flex-shrink: 0;
    position: relative;
  }
</style>
