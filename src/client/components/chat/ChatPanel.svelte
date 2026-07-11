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
  export let onopenfile = null;

  let editContent = '';
  let editingMessageId = null;

  // 覆盖 suggestions
  $: suggestions = [
    { text: _t('chat.suggestion1'), label: _t('chat.suggestion1'), icon: '⚛' },
    { text: _t('chat.suggestion2'), label: _t('chat.suggestion2'), icon: '📁' },
    { text: _t('chat.suggestion3'), label: _t('chat.suggestion3'), icon: '🐛' },
    { text: '/help', label: _t('chat.suggestion4'), icon: '❓' }
  ];

  function handleSend(data) {
    const text = typeof data === 'string' ? data : data.text;
    const files = typeof data === 'object' ? (data.files || []) : [];
    const images = typeof data === 'object' ? (data.images || []) : [];

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
    ontoggleSidebar={onToggleSidebar || toggleChatSidebar}
    onnewchat={handleNewChat}
    onsettings={handleSettings}
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
      {onopenfile}
    />

    <div class="input-area">
      <ModelParametersPanel
        show={$paramsPanelOpen}
        onclose={closeParamsPanel}
      />
      <ChatControls
        open={$controlsPanelOpen}
        onclose={() => controlsPanelOpen.set(false)}
      />
      <ChatInput
        onsend={handleSend}
        ontoggleParams={toggleParamsPanel}
        paramsOpen={$paramsPanelOpen}
        {editContent}
        oneditSent={() => { editContent = ''; editingMessageId = null; }}
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
