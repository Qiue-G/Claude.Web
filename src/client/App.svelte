<script>
  import { onMount, onDestroy } from 'svelte';
  import Toolbar from '$components/common/Toolbar.svelte';
  import FileTree from '$components/files/FileTree.svelte';
  import ChatPanel from '$components/chat/ChatPanel.svelte';
  import ChatSidebar from '$components/chat/ChatSidebar.svelte';
  import CodeEditor from '$components/editor/CodeEditor.svelte';
  import ConfigModal from '$components/models/ConfigModal.svelte';
  import CommandPalette from '$components/common/CommandPalette.svelte';
  import Toast from '$components/common/Toast.svelte';

  import { isConnected } from '$stores/session.store.js';
  import { activeModelId, savedModels } from '$stores/models.store.js';
  import { fileContents } from '$stores/files.store.js';
  import { messages, isWaiting, isTyping, addMessage } from '$stores/chat.store.js';
  import { initChatHistory, createSession, switchSession, currentSessionId } from '$stores/chatHistory.store.js';
  import { chatSidebarOpen, fileSidebarOpen, toggleChatSidebar, toggleFileSidebar, openCommandPalette, showToast } from '$stores/ui.store.js';
  import { toggleTheme } from '$stores/theme.store.js';
  import { connectWebSocket, sendInput } from '$lib/websocket.js';
  import { createSession as apiCreateSession } from '$apis/session.api.js';
  import { writeFile } from '$apis/files.api.js';
  import { sessionId, sessionToken, csrfToken } from '$stores/session.store.js';
  import { get } from 'svelte/store';

  let showConfigModal = $state(false);

  // 聊天/编辑器面板拖拽分割
  let chatFlex = $state(7);
  let editorFlex = $state(3);
  let isResizing = $state(false);

  function handleResizeStart(e) {
    isResizing = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }

  function handleResizeMove(e) {
    if (!isResizing) return;
    const container = document.querySelector('.content-pane-group');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const totalHeight = rect.height;
    const mouseY = e.clientY - rect.top;
    const minPx = 100;
    const chatPx = Math.max(minPx, Math.min(mouseY, totalHeight - minPx));
    chatFlex = chatPx;
    editorFlex = totalHeight - chatPx;
  }

  function handleResizeEnd() {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  function handleToggleSidebar() { toggleFileSidebar(); }
  function handleToggleChatSidebar() { toggleChatSidebar(); }
  function handleOpenConfig() { showConfigModal = true; }
  function handleCloseConfig() { showConfigModal = false; }

  function handleSelectModel(e) {
    const model = e.detail;
    if (!model) return;
    handleConnectModel({ detail: model });
  }

  function handleNewChat() {
    createSession();
    showToast('新对话已创建', 'success');
  }

  function handleSelectChatSession(e) {
    const detail = e.detail;
    if (detail && detail.sessionId) {
      switchSession(detail.sessionId);
    }
  }

  function handleFileSelect(e) {
    const file = e.detail;
    if (!file || file.type !== 'file') return;
    showToast('已选择文件: ' + file.path, 'success');
  }

  function handleTabClose(e) {
    const path = e.detail;
    fileContents.update(files => { const { [path]: _, ...rest } = files; return rest; });
  }

  function handleEditorChange(e) {
    const { path, content } = e.detail;
    fileContents.update(files => ({ ...files, [path]: content }));
  }

  async function handleSaveFile(e) {
    const { path, content } = e.detail;
    if (!path) {
      showToast('没有文件可保存', 'error');
      return;
    }
    try {
      const sid = get(sessionId);
      const tok = get(sessionToken);
      const csrf = get(csrfToken);
      await writeFile(sid, path, content, tok, csrf);
      showToast('文件已保存: ' + path, 'success');
    } catch (err) {
      showToast('保存失败: ' + (err.message || '未知错误'), 'error');
    }
  }

  async function handleConnectModel(e) {
    const model = e.detail;
    try {
      const session = await apiCreateSession(model.apiKey, model.model, model.provider);
      // 后端返回 { sessionId, token, csrfToken }
      sessionId.set(session.sessionId);
      sessionToken.set(session.token);
      if (session.csrfToken) csrfToken.set(session.csrfToken);
      connectWebSocket(session.sessionId, session.token);
      showToast('已连接: ' + model.name, 'success');
      showConfigModal = false;
    } catch (err) {
      showToast('连接失败: ' + (err.message || '未知错误'), 'error');
    }
  }

  let sendTimeout = $state(null);

  // 发送超时自动恢复
  $effect(() => {
    if ($isWaiting) {
      sendTimeout = setTimeout(() => {
        isWaiting.set(false);
        isTyping.set(false);
        addMessage('system', '响应超时，请重试');
        sendTimeout = null;
      }, 60000);
    } else {
      if (sendTimeout) {
        clearTimeout(sendTimeout);
        sendTimeout = null;
      }
    }
  });

  function handleChatSend(data) {
    const text = typeof data === 'string' ? data : data.text;
    const files = typeof data === 'object' ? (data.files || []) : [];
    const images = typeof data === 'object' ? (data.images || []) : [];
    if (!text || !text.trim()) return;
    if (!$isConnected) { addMessage('system', '请先连接模型'); return; }
    // 如果没有当前会话，自动创建新对话
    if (!get(currentSessionId)) {
      createSession('新对话');
    }
    addMessage('user', text);
    isWaiting.set(true);
    sendInput({ text, files, images });
  }

  onMount(async () => {
    await initChatHistory();
    // 自动重连：如果有保存的 session 凭证，页面刷新后自动恢复连接
    const sid = $sessionId;
    const token = $sessionToken;
    if (sid && token) {
      connectWebSocket(sid, token);
    }
    if ($activeModelId && $savedModels.length > 0) {
      const m = $savedModels.find(m => m.id === $activeModelId);
      if (m) showToast('已加载模型: ' + m.name, 'success');
    }
    window.addEventListener('keydown', handleGlobalKeydown);
    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleGlobalKeydown);
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', handleResizeEnd);
  });

  function handleGlobalKeydown(e) {
    const mod = e.ctrlKey || e.metaKey;

    // Ctrl+K → 命令面板
    if (mod && e.key === 'k') {
      e.preventDefault();
      openCommandPalette();
      return;
    }
    // Ctrl+Shift+N → 新建对话
    if (mod && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('command:new-chat'));
      return;
    }
    // Ctrl+B → 文件侧边栏
    if (mod && !e.shiftKey && (e.key === 'B' || e.key === 'b')) {
      e.preventDefault();
      toggleFileSidebar();
      return;
    }
    // Ctrl+Shift+B → 对话侧边栏
    if (mod && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
      e.preventDefault();
      toggleChatSidebar();
      return;
    }
    // Ctrl+I → 聚焦输入框
    if (mod && !e.shiftKey && (e.key === 'I' || e.key === 'i')) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('command:focus-input'));
      return;
    }
    // Ctrl+Shift+T → 切换主题
    if (mod && e.shiftKey && (e.key === 'T' || e.key === 't')) {
      e.preventDefault();
      toggleTheme();
      return;
    }
  }
</script>

<div class="app">
  <Toolbar on:toggleSidebar={handleToggleSidebar} on:openConfig={handleOpenConfig} on:selectModel={handleSelectModel} />

  <div class="main-layout">
    {#if $chatSidebarOpen}
      <div class="chat-sidebar-container"><ChatSidebar on:newchat={handleNewChat} on:select={handleSelectChatSession} /></div>
    {/if}
    {#if $fileSidebarOpen}
      <div class="sidebar"><FileTree on:fileSelect={handleFileSelect} /></div>
    {/if}
    <div class="content-pane-group">
      <div class="chat-pane" style="flex: {chatFlex};"><ChatPanel onsend={handleChatSend} /></div>
      <button class="resize-handle" class:active={isResizing} onmousedown={handleResizeStart} aria-label="调整面板大小"></button>
      <div class="editor-pane" style="flex: {editorFlex};"><CodeEditor on:tabClose={handleTabClose} on:change={handleEditorChange} on:save={handleSaveFile} /></div>
    </div>
  </div>

  <ConfigModal bind:open={showConfigModal} on:close={handleCloseConfig} on:connect={handleConnectModel} />
  <CommandPalette />
  <Toast />
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100vh; background: var(--bg-base); }
  .main-layout { display: flex; flex: 1; overflow: hidden; }
  .chat-sidebar-container { width: 280px; background: var(--bg-raised); border-right: 1px solid var(--border); overflow: hidden; }
  .sidebar { width: 240px; background: var(--bg-raised); border-right: 1px solid var(--border); overflow: hidden; }
  :global(button.resize-handle) {
    display: block;
    height: 4px;
    padding: 0;
    border: none;
    background: var(--border);
    cursor: row-resize;
    flex-shrink: 0;
    position: relative;
    transition: background 0.15s;
    outline: none;
  }
  :global(button.resize-handle:hover),
  :global(button.resize-handle:focus-visible),
  :global(button.resize-handle.active) { background: var(--amber); }
  .content-pane-group { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .chat-pane { overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
  .editor-pane { overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
</style>
