<script>
  // App root component — v7.3.2
  import { onMount, onDestroy } from 'svelte';
  import Toolbar from '$components/common/Toolbar.svelte';
  import FileTree from '$components/files/FileTree.svelte';
  import ChatPanel from '$components/chat/ChatPanel.svelte';
  import ChatSidebar from '$components/chat/ChatSidebar.svelte';
  import CodeEditor from '$components/editor/CodeEditor.svelte';
  import ConfigModal from '$components/models/ConfigModal.svelte';
  import CommandPalette from '$components/common/CommandPalette.svelte';
  import Toast from '$components/common/Toast.svelte';
  import ToolApprovalModal from '$components/chat/ToolApprovalModal.svelte';
  import RagPanel from '$components/rag/RagPanel.svelte';
  import AuditLogViewer from '$components/admin/AuditLogViewer.svelte';
  import Modal from '$components/common/Modal.svelte';
  import { sendToolApproval } from '$lib/websocket.js';

  import { isConnected } from '$stores/session.store.js';
  import { activeModelId, savedModels, switchModel } from '$stores/models.store.js';
  import { fileContents, fileTree, openFile, closeTab, currentFile } from '$stores/files.store.js';
  import { messages, isWaiting, isTyping, addMessage } from '$stores/chat.store.js';
  import { initChatHistory, createSession, switchSession, currentSessionId } from '$stores/chatHistory.store.js';
  import { chatSidebarOpen, fileSidebarOpen, toggleChatSidebar, toggleFileSidebar, showToast } from '$stores/ui.store.js';
  import { openCommandPalette } from '$stores/keyboard.store.js';
  import { toggleTheme } from '$stores/theme.store.js';
  import { connectWebSocket, sendInput } from '$lib/websocket.js';
  import { enabledTools } from '$stores/tools.store.js';
  import { createSession as apiCreateSession, validateSession } from '$apis/session.api.js';
  import { writeFile, readFile, getFileTree } from '$apis/files.api.js';
  import FileHistoryPanel from '$components/files/FileHistoryPanel.svelte';
  import { sessionId, sessionToken, csrfToken } from '$stores/session.store.js';
  import { get } from 'svelte/store';
  import { t } from '$lib/i18n.js';
  $: _t = $t;
  import { readFilesForAI } from '$lib/attachments.js';
  import { initPlugins, pluginsConfig, activeThemeTokens, getEnabledTokens, applyThemeTokens } from '$stores/plugins.store.js';
  import { initFilters } from '$stores/filters.store.js';
  import { effectiveTheme } from '$stores/theme.store.js';
  import { fetchConfig } from '$apis/models.api.js';

  let showConfigModal = false;
  let showRagPanel = false;
  let showAdminPanel = false;

  // 工具审批弹窗状态
  let pendingApproval = null; // { approvalId, tools }

  function handleToolApprovalRequest(e) {
    pendingApproval = {
      approvalId: e.detail.approvalId,
      tools: e.detail.tools
    };
  }

  function handleToolApprovalComplete() {
    pendingApproval = null;
  }

  function handleApproveTool(approvalId, selectedTools) {
    sendToolApproval(approvalId, selectedTools);
    pendingApproval = null;
  }

  function handleRejectTool(approvalId) {
    sendToolApproval(approvalId, []);
    pendingApproval = null;
  }

  // 聊天/编辑器面板拖拽分割
  let chatFlex = 7;
  let editorFlex = 3;
  let isResizing = false;

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
  function handleOpenRag() { showRagPanel = true; }
  function handleOpenAdmin() { showAdminPanel = true; }
  function handleCloseConfig() { showConfigModal = false; }

  function handleSelectModel(e) {
    const model = e.detail;
    if (!model) return;
    handleConnectModel({ detail: model });
  }

  function handleNewChat() {
    createSession();
    showToast(get(t)('toast.newChatCreated'), 'success');
  }

  function handleSelectChatSession(e) {
    const detail = e.detail;
    if (detail && detail.sessionId) {
      switchSession(detail.sessionId);
    }
  }

  // ===== File loading =====

  async function loadFileTree(sid, tok) {
    try {
      const result = await getFileTree(sid, tok);
      if (result && result.tree) {
        fileTree.set(result.tree);
      }
    } catch (err) {
      console.error('Failed to load file tree:', err.message);
    }
  }

  async function handleFileSelect(e) {
    const file = e.detail;
    if (!file || file.type !== 'file') return;
    try {
      const sid = get(sessionId);
      const tok = get(sessionToken);
      const result = await readFile(sid, file.path, tok);
      if (result && result.content !== undefined) {
        openFile(file.path, result.content);
      }
    } catch (err) {
      showToast(get(t)('toast.fileOpenFailed', { error: err.message || get(t)('common.error') }), 'error');
    }
  }

  function handleTabClose(e) {
    const path = e.detail;
    closeTab(path);
  }

  function handleEditorChange(e) {
    const { path, content } = e.detail;
    fileContents.update(files => ({ ...files, [path]: content }));
  }

  async function handleSaveFile(e) {
    const detail = e.detail;
    const path = typeof detail === 'string' ? detail : detail.path;
    const content = typeof detail === 'object' ? detail.content : undefined;
    if (!path) {
      showToast(get(t)('toast.noFileToSave'), 'error');
      return;
    }
    try {
      const sid = get(sessionId);
      const tok = get(sessionToken);
      const csrf = get(csrfToken);
      const saveContent = content !== undefined ? content : (get(fileContents)[path] || '');
      await writeFile(sid, path, saveContent, tok, csrf);
      showToast(get(t)('toast.fileSaved', { path }), 'success');
    } catch (err) {
      showToast(get(t)('toast.fileSaveFailed', { error: err.message || get(t)('common.error') }), 'error');
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
      switchModel(model.id);
      connectWebSocket(session.sessionId, session.token);
      showToast(get(t)('toast.connected') + ' ' + model.name, 'success');
      showConfigModal = false;
      // 加载文件列表
      loadFileTree(session.sessionId, session.token);
    } catch (err) {
      showToast(get(t)('toast.connectionFailed') + ': ' + (err.message || get(t)('common.error')), 'error');
    }
  }

  let sendTimeout = null;
  let isApprovalActive = false; // 跟踪审批弹窗状态

  // 发送超时自动恢复（工具审批等待时不超时）
  $: {
    if (isApprovalActive) {
      // 审批期间：不启动任何超时
      if (sendTimeout) {
        clearTimeout(sendTimeout);
        sendTimeout = null;
      }
    } else if ($isWaiting) {
      // 非审批期间的等待：启动超时
      if (!sendTimeout) {
        const timeoutMs = 90000; // 审批后的等待给 90s
        sendTimeout = setTimeout(() => {
          isWaiting.set(false);
          isTyping.set(false);
          addMessage('system', get(t)('chat.timeout'));
          sendTimeout = null;
        }, timeoutMs);
      }
    } else {
      // 非等待状态：清除超时
      if (sendTimeout) {
        clearTimeout(sendTimeout);
        sendTimeout = null;
      }
    }
  }

  // 监听审批弹窗状态
  $: isApprovalActive = pendingApproval !== null;

  async function handleChatSend(data) {
    const text = typeof data === 'string' ? data : data.text;
    const files = typeof data === 'object' ? (data.files || []) : [];
    const images = typeof data === 'object' ? (data.images || []) : [];
    // 如果没有文字但有附件，允许发送
    if ((!text || !text.trim()) && files.length === 0 && images.length === 0) return;
    if (!$isConnected) { addMessage('system', get(t)('system.connectFirst')); return; }
    // 如果没有当前会话，自动创建新对话
    if (!get(currentSessionId)) {
      createSession(get(t)('chat.new'));
    }

    // 读取附件文件内容嵌入到消息文本中（给 AI 看），UI 只展示文件卡片元数据
    let fileContentForAI = '';
    let fileMeta = [];
    if (files.length > 0) {
      const result = await readFilesForAI(files);
      fileContentForAI = result.content;
      fileMeta = result.fileMeta;
    }
    // 图片作为消息的一部分
    let imageContent = '';
    if (images.length > 0) {
      imageContent = '\n\n' + get(t)('system.containsImages');
    }

    // 给 AI 发送的内容包含文件内容
    const fullText = [text.trim(), fileContentForAI].filter(Boolean).join('\n\n') + imageContent;

    // UI 显示只包含用户输入的文字 + 文件名（文件内容和图片不展示在消息渲染中）
    const displayText = text.trim() + (fileMeta.length > 0 ? '\n' + get(t)('system.filesAttached') : '') + imageContent;

    addMessage('user', displayText, null, fileMeta.length > 0 ? fileMeta : null);
    isWaiting.set(true);
    sendInput({ text: fullText, files: [], images, tools: get(enabledTools) });
  }

  onMount(async () => {
    await initChatHistory();

    // 自动重连：验证存储的 session 凭证 → 有效则恢复连接 + 模型状态
    const sid = $sessionId;
    const token = $sessionToken;
    if (sid && token) {
      try {
        const sessionInfo = await validateSession(sid, token);
        // Session 有效，自动恢复 WebSocket 连接
        connectWebSocket(sid, token);
        loadFileTree(sid, token);

        // 恢复模型显示：如果 stored activeModelId 存在，标记为已连接
        if ($activeModelId) {
          const m = $savedModels.find(m => m.id === $activeModelId);
          if (m) showToast(get(t)('toast.reconnected') + ': ' + m.name, 'success');
        } else {
          showToast(get(t)('toast.reconnected'), 'success');
        }
      } catch (_) {
        // Session 已过期或不合法 → 清理凭据，保持"未连接"状态
        console.log('[SESSION] stored session expired, clearing credentials');
        sessionId.set(null);
        sessionToken.set(null);
        csrfToken.set(null);
        // 不清除 savedModels/activeModelId，方便用户一键重新连接
        if ($activeModelId && $savedModels.length > 0) {
          const m = $savedModels.find(m => m.id === $activeModelId);
          if (m) showToast(get(t)('toast.sessionExpired'), 'error');
        }
      }
    } else {
      // 无存储的 session，但如果有保存的模型，提示连接
      if ($savedModels.length > 0 && $activeModelId) {
        const m = $savedModels.find(m => m.id === $activeModelId);
        if (m) showToast(get(t)('toast.clickToConnect', { name: m.name }), 'info');
      }
    }

    window.addEventListener('keydown', handleGlobalKeydown);
    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);
    window.addEventListener('tool-approval-request', handleToolApprovalRequest);
    window.addEventListener('tool-approval-complete', handleToolApprovalComplete);

    // === 加载插件配置 ===
    try {
      const config = await fetchConfig();
      if (config && config.plugins) {
        initPlugins(config.plugins);
        // 将所有主题插件标记为初始激活
        const initialActive = {};
        for (const id of Object.keys(config.plugins)) {
          if (config.plugins[id].manifest?.tokens) initialActive[id] = true;
        }
        activeThemeTokens.set(initialActive);
        // 初始主题令牌（依赖 $effect 自动注入）
      }
      if (config && config.filters) {
        initFilters(config.filters);
      }
    } catch (e) {
      console.warn('[PLUGINS] failed to load config:', e.message);
    }
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleGlobalKeydown);
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', handleResizeEnd);
    window.removeEventListener('tool-approval-request', handleToolApprovalRequest);
    window.removeEventListener('tool-approval-complete', handleToolApprovalComplete);
  });

  // === 响应主题/插件配置变化，更新主题令牌 ===
  $: {
    const cfg = $pluginsConfig;
    const theme = $effectiveTheme;
    const active = $activeThemeTokens;
    if (cfg && theme) {
      const tokens = getEnabledTokens(theme, cfg, active);
      applyThemeTokens(tokens);
    }
  }

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
  <Toolbar on:toggleSidebar={handleToggleSidebar} on:openConfig={handleOpenConfig} on:openRag={handleOpenRag} on:openAdmin={handleOpenAdmin} on:selectModel={handleSelectModel} />

  <div class="main-layout">
    {#if $chatSidebarOpen}
      <div class="chat-sidebar-container"><ChatSidebar on:newchat={handleNewChat} on:select={handleSelectChatSession} /></div>
    {/if}
    {#if $fileSidebarOpen}
      <div class="sidebar">
        <FileTree on:fileSelect={handleFileSelect} />
        {#if $currentFile}
          <FileHistoryPanel filePath={$currentFile} on:rollback={handleFileSelect} />
        {/if}
      </div>
    {/if}
    <div class="content-pane-group">
      <div class="chat-pane" style="flex: {chatFlex};"><ChatPanel onsend={handleChatSend} /></div>
      <button class="resize-handle" class:active={isResizing} onmousedown={handleResizeStart} aria-label={_t('editor.resizeHandle')}></button>
      <div class="editor-pane" style="flex: {editorFlex};"><CodeEditor on:tabClose={handleTabClose} on:change={handleEditorChange} on:save={handleSaveFile} /></div>
    </div>
  </div>

  <ConfigModal bind:open={showConfigModal} on:close={handleCloseConfig} on:connect={handleConnectModel} />
  <Modal bind:open={showRagPanel} title={_t('rag.title')} width="560px">
    <RagPanel />
  </Modal>
  <Modal bind:open={showAdminPanel} title={_t('admin.button')} width="800px">
    <AuditLogViewer />
  </Modal>
  <CommandPalette />
  <Toast />
  {#if pendingApproval}
    <ToolApprovalModal
      pendingTools={pendingApproval.tools}
      approvalId={pendingApproval.approvalId}
      onapprove={handleApproveTool}
      onreject={handleRejectTool}
    />
  {/if}
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
