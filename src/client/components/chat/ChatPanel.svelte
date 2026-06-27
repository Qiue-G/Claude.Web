<script>
  import { messages, addMessage, updateMessage } from '$stores/chat.store.js';
  import {
    currentSession,
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

  import Navbar from './Navbar.svelte';
  import Messages from './Messages.svelte';
  import ChatInput from './ChatInput.svelte';
  import ModelParametersPanel from './ModelParametersPanel.svelte';
  import ChatControls from './ChatControls.svelte';

  let {
    onsend = null
  } = $props();

  let editContent = $state('');

  // i18n 建议按钮
  let suggestions = $derived([
    { text: $t('chat.suggestion1'), label: $t('chat.suggestion1'), icon: '⚛' },
    { text: $t('chat.suggestion2'), label: $t('chat.suggestion2'), icon: '📁' },
    { text: $t('chat.suggestion3'), label: $t('chat.suggestion3'), icon: '🐛' },
    { text: '/help', label: $t('chat.suggestion4'), icon: '❓' }
  ]);

  function handleSend(e) {
    const detail = e.detail;
    const text = typeof detail === 'string' ? detail : detail.text;
    const files = typeof detail === 'object' ? (detail.files || []) : [];
    const images = typeof detail === 'object' ? (detail.images || []) : [];

    if (!text || !text.trim()) return;
    addMessage('user', text.trim());
    onsend?.({ text: text.trim(), files, images });
  }

  function handleNewChat() { createSession(); }
  function handleSettings() { openControlsPanel(); }

  function handleEditMessage(e) {
    const { id, content } = e.detail;
    editContent = content;
  }

  function handleRetryMessage(e) {
    const { id } = e.detail;
    if (!$currentSession) return;
    const msgs = $currentSession.messages || [];
    if (id) {
      for (let i = msgs.findIndex(m => m.id === id) - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') { onsend?.(msgs[i].content); break; }
      }
    }
  }

  function handleRateMessage(e) {
    const { id, rating } = e.detail;
    updateMessage(id, { rating });
  }
</script>

<div class="chat-area">
  <Navbar
    sidebarOpen={$chatSidebarOpen}
    on:toggleSidebar={toggleChatSidebar}
    on:newchat={handleNewChat}
    on:settings={handleSettings}
  />

  <div class="chat-content">
    <Messages
      messages={$messages}
      on:edit={handleEditMessage}
      on:retry={handleRetryMessage}
      on:rate={handleRateMessage}
      on:suggestion={(e) => {
        addMessage('user', e.detail);
        onsend?.(e.detail);
      }}
      {suggestions}
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
        on:editSent={() => editContent = ''}
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
