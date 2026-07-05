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
  import Modal from '$components/common/Modal.svelte';
  import InstallPrompt from '$components/common/InstallPrompt.svelte';
  import { sendToolApproval } from '$lib/websocket.js';

  // Parallel comparison store (keep store small)
  import { parallelMode, selectedModels, parallelResults, parallelRunning, parallelSummary, resetParallel, addParallelChunk, markModelDone } from '$stores/parallel.store.js';
  import ParallelToggle from '$components/parallel/ParallelToggle.svelte';
  import ModelMultiSelect from '$components/parallel/ModelMultiSelect.svelte';
  import { sendParallel } from '$lib/websocket.js';

  // Auth state
  let showLoginModal = $state(false);
  let showUserMenu = $state(false);

  function handleOpenLogin() {
    showLoginModal = true;
  }

  function handleCloseLogin() {
    showLoginModal = false;
  }

  function handleLoginSuccess(e) {
    showLoginModal = false;
    const { sessionId: sid, sessionToken: token } = e;
    if (sid && token) {
      connectWebSocket(sid, token);
    }
  }

  function handleLogout() {
    destroyCollab();
    clearAuth();
    showUserMenu = false;
    // Disconnect WebSocket
    disconnectWebSocket();
  }

  // ── 协作客户端管理 ──
  let _collabInstance = null;

  function initCollab() {
    const ws = getWs();
    const sid = $sessionId;
    const token = $sessionToken;
    if (!ws || !sid || ws.readyState !== WebSocket.OPEN) return;

    // 销毁旧的协作实例
    if (_collabInstance) {
      _collabInstance.destroy();
      _collabInstance = null;
    }

    const username = $authUser?.username || 'anonymous';
    const client = new CollabClient(ws, sid, token, username);

    client.onAwarenessChange((users) => {
      onlineUsers.set(users);
    });

    client.connect();
    _collabInstance = client;
    collabClientStore.set(client);
  }

  function destroyCollab() {
    if (_collabInstance) {
      _collabInstance.destroy();
      _collabInstance = null;
      collabClientStore.set(null);
      onlineUsers.set([]);
    }
  }

  // Lazy loaded components (code-split at build time)
  let RagPanelComponent = $state(null);
  let AuditLogComponent = $state(null);
  let PerfDashboardComponent = $state(null);
  let ComparisonViewComponent = $state(null);

  // Trigger lazy loading when components are first needed
  $effect(() => {
    if (showRagPanel && !RagPanelComponent) {
      import('$components/rag/RagPanel.svelte').then(m => { RagPanelComponent = m.default; });
    }
  });
  $effect(() => {
    if (showAdminPanel && !AuditLogComponent && adminTab === 'audit') {
      import('$components/admin/AuditLogViewer.svelte').then(m => { AuditLogComponent = m.default; });
    }
  });
  $effect(() => {
    if (showAdminPanel && adminTab === 'perf' && !PerfDashboardComponent) {
      import('$components/admin/PerfDashboard.svelte').then(m => { PerfDashboardComponent = m.default; });
    }
  });
  $effect(() => {
    if ($parallelMode && !ComparisonViewComponent) {
      import('$components/parallel/ComparisonView.svelte').then(m => { ComparisonViewComponent = m.default; });
    }
  });

  import { isConnected } from '$stores/session.store.js';
  import { activeModelId, savedModels, switchModel } from '$stores/models.store.js';
  import { fileContents, fileTree, openFile, closeTab, currentFile } from '$stores/files.store.js';
  import { messages, isWaiting, isTyping, addMessage } from '$stores/chat.store.js';
  import { initChatHistory, createSession, switchSession, currentSessionId } from '$stores/chatHistory.store.js';
  import { chatSidebarOpen, fileSidebarOpen, toggleChatSidebar, toggleFileSidebar, showToast } from '$stores/ui.store.js';
  import { openCommandPalette } from '$stores/keyboard.store.js';
  import { toggleTheme } from '$stores/theme.store.js';
  import { connectWebSocket, sendInput, disconnectWebSocket, onWsReady, getWs } from '$lib/websocket.js';
  import { CollabClient } from '$lib/collab.js';
  import { onlineUsers, collabClient as collabClientStore } from '$stores/collab.store.js';
  import { enabledTools } from '$stores/tools.store.js';
  import { createSession as apiCreateSession, validateSession } from '$apis/session.api.js';
  import { writeFile, readFile, getFileTree } from '$apis/files.api.js';
  import FileHistoryPanel from '$components/files/FileHistoryPanel.svelte';
  import { sessionId, sessionToken, csrfToken } from '$stores/session.store.js';
  import { get } from 'svelte/store';
  import { t } from '$lib/i18n.js';
  import LoginModal from '$components/auth/LoginModal.svelte';
  import { authUser, authToken, isAuthenticated, clearAuth } from '$stores/auth.store.js';
  let _t = $derived($t);
  import { readFilesForAI } from '$lib/attachments.js';
  import { initPlugins, pluginsConfig, activeThemeTokens, getEnabledTokens, applyThemeTokens } from '$stores/plugins.store.js';
  import { initFilters } from '$stores/filters.store.js';
  import { effectiveTheme } from '$stores/theme.store.js';
  import { fetchConfig } from '$apis/models.api.js';

  // === 响应式状态 ===
  let isMobile = $state(false);
  let isTablet = $state(false);
  let isOnline = $state(typeof navigator !== 'undefined' ? navigator.onLine : true);
  let drawerChatOpen = $state(false);
  let drawerFileOpen = $state(false);
  let mobileEditorVisible = $state(false);
  let touchStartX = $state(0);
  let touchStartY = $state(0);
  let isSwiping = $state(false);

  // Detect screen size on mount and on resize
  function checkScreenSize() {
    const w = window.innerWidth;
    isMobile = w < 640;
    isTablet = w >= 640 && w < 1024;
  }

  function openDrawerChat() { drawerChatOpen = true; }
  function closeDrawerChat() { drawerChatOpen = false; }
  function openDrawerFile() { drawerFileOpen = true; }
  function closeDrawerFile() { drawerFileOpen = false; }

  // Touch gesture for sidebar drawer
  function handleTouchStart(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isSwiping = false;
  }

  function handleTouchMove(e) {
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
      isSwiping = true;
    }
  }

  function handleTouchEnd(e) {
    if (!isSwiping) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const windowW = window.innerWidth;
    if (dx > 60 && !drawerChatOpen) {
      // 右滑：打开聊天侧边栏（从左侧边缘触发）
      if (touchStartX < 40) openDrawerChat();
    } else if (dx > 60 && drawerFileOpen) {
      // 右滑：关闭文件侧边栏
      closeDrawerFile();
    } else if (dx < -60 && drawerChatOpen) {
      // 左滑：关闭聊天侧边栏
      closeDrawerChat();
    } else if (dx < -60 && !drawerFileOpen) {
      // 左滑：打开文件侧边栏（从右侧边缘触发）
      if (touchStartX > windowW - 40) openDrawerFile();
    }
    isSwiping = false;
  }

  // 移动端：点击编辑器标签时切换编辑器面板
  function toggleMobileEditor() {
    mobileEditorVisible = !mobileEditorVisible;
  }

  let showConfigModal = $state(false);
  let showRagPanel = $state(false);
  let showAdminPanel = $state(false);
  let adminTab = $state('audit'); // 'audit' | 'perf'

  // 工具审批弹窗状态
  let pendingApproval = $state(null); // { approvalId, tools }

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

  function handleToggleSidebar() {
    if (isMobile || isTablet) {
      openDrawerFile();
    } else {
      toggleFileSidebar();
    }
  }
  function handleToggleChatSidebar() {
    if (isMobile || isTablet) {
      openDrawerChat();
    } else {
      toggleChatSidebar();
    }
  }
  function handleOnline() { isOnline = true; }
  function handleOffline() { isOnline = false; }
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

  // ===== Parallel comparison handlers =====
  function handleParallelStart() {
    const models = get(selectedModels);
    if (models.length < 2) {
      addMessage('system', get(t)('parallel.minModels'));
      return;
    }
    const prompt = window.prompt(get(t)('parallel.enterPrompt'));
    if (!prompt || !prompt.trim()) return;
    handleSendParallel(prompt.trim());
  }

  function handleParallelChunk(e) {
    const { modelId, text, done } = e.detail;
    addParallelChunk(modelId, text);
  }

  function handleParallelModelDone(e) {
    const { modelId, status, latency, tokens, error } = e.detail;
    markModelDone(modelId, status, latency, tokens, error);
  }

  function handleParallelAllDone(e) {
    const { results, summary } = e.detail;
    parallelResults.set(results || {});
    parallelSummary.set(summary);
    parallelRunning.set(false);
  }

  function handleParallelError(e) {
    parallelRunning.set(false);
    addMessage('system', 'Parallel comparison failed: ' + (e.detail?.message || 'Unknown error'));
  }

  function handleParallelResultSelected(e) {
    const { modelId, text } = e.detail;
    if (!text) return;
    // 将采纳的结果作为用户消息添加到会话，触发发送
    addMessage('user', `[${modelId}] 结果:\n\n${text}`);
    // 同时将文本放入剪贴板
    navigator.clipboard?.writeText(text);
    addMessage('system', `已采纳 ${modelId} 的结果`);
  }

  function handleSendParallel(prompt) {
    const models = get(selectedModels);
    if (models.length < 2) {
      addMessage('system', get(t)('Please select at least 2 models'));
      return;
    }
    parallelRunning.set(true);
    resetParallel();
    addMessage('user', prompt);
    sendParallel(prompt, models);
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

  function handleFilesChanged() {
    const sid = $sessionId;
    const tok = $sessionToken;
    if (sid && tok) loadFileTree(sid, tok);
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
  // 监听审批弹窗状态（derived in runes mode）
  let isApprovalActive = $derived(pendingApproval !== null);

  // 发送超时自动恢复（工具审批等待时不超时）
  $effect(() => {
    if (isApprovalActive) {
      // 审批期间：不启动任何超时
      if (sendTimeout) {
        clearTimeout(sendTimeout);
        sendTimeout = null;
      }
    } else if ($isWaiting) {
      // 非审批期间的等待：启动超时
      if (!sendTimeout) {
        const timeoutMs = 90000;
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
  });

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
    checkScreenSize();

    await initChatHistory();

    // 注册协作客户端就绪回调（在每次 WebSocket ready 后自动初始化）
    onWsReady(() => initCollab());

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
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('resize', checkScreenSize);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('tool-approval-request', handleToolApprovalRequest);
    window.addEventListener('tool-approval-complete', handleToolApprovalComplete);
    window.addEventListener('files-changed', handleFilesChanged);

    // Parallel comparison events
    window.addEventListener('parallel-start-request', handleParallelStart);
    window.addEventListener('parallel-chunk', handleParallelChunk);
    window.addEventListener('parallel-model-done', handleParallelModelDone);
    window.addEventListener('parallel-all-done', handleParallelAllDone);
    window.addEventListener('parallel-error', handleParallelError);
    window.addEventListener('parallel-result-selected', handleParallelResultSelected);

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
    destroyCollab();
    window.removeEventListener('keydown', handleGlobalKeydown);
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', handleResizeEnd);
    window.removeEventListener('touchstart', handleTouchStart);
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
    window.removeEventListener('resize', checkScreenSize);
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener('tool-approval-request', handleToolApprovalRequest);
    window.removeEventListener('tool-approval-complete', handleToolApprovalComplete);
    window.removeEventListener('files-changed', handleFilesChanged);
    window.removeEventListener('parallel-start-request', handleParallelStart);
    window.removeEventListener('parallel-chunk', handleParallelChunk);
    window.removeEventListener('parallel-model-done', handleParallelModelDone);
    window.removeEventListener('parallel-all-done', handleParallelAllDone);
    window.removeEventListener('parallel-error', handleParallelError);
    window.removeEventListener('parallel-result-selected', handleParallelResultSelected);
  });

  // === 响应主题/插件配置变化，更新主题令牌 ===
  $effect(() => {
    const cfg = $pluginsConfig;
    const theme = $effectiveTheme;
    const active = $activeThemeTokens;
    if (cfg && theme) {
      const tokens = getEnabledTokens(theme, cfg, active);
      applyThemeTokens(tokens);
    }
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
  {#if !isOnline}
    <div class="offline-banner">离线模式 - 部分功能不可用</div>
  {/if}
  <Toolbar on:toggleSidebar={handleToggleSidebar} on:openConfig={handleOpenConfig} on:openRag={handleOpenRag} on:openAdmin={handleOpenAdmin} on:selectModel={handleSelectModel} />

  <div class="parallel-bar">
    <ParallelToggle models={$savedModels} />
    <ModelMultiSelect models={$savedModels} disabled={$parallelRunning} />
  </div>

  <div class="main-layout">
    <!-- 桌面端侧边栏（≥ 900px 内联显示） -->
    {#if !isMobile && !isTablet && $chatSidebarOpen}
      <div class="chat-sidebar-container"><ChatSidebar on:newchat={handleNewChat} on:select={handleSelectChatSession} /></div>
    {/if}
    {#if !isMobile && !isTablet && $fileSidebarOpen}
      <div class="sidebar">
        <FileTree on:fileSelect={handleFileSelect} />
        {#if $currentFile}
          <FileHistoryPanel filePath={$currentFile} on:rollback={handleFileSelect} />
        {/if}
      </div>
    {/if}

    <!-- 移动端/平板端聊天侧边栏 Drawer -->
    {#if isMobile || isTablet}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="drawer-overlay"
        class:closed={!drawerChatOpen}
        onclick={closeDrawerChat}
        role="presentation"
      ></div>
      <div class="sidebar-drawer" class:closed={!drawerChatOpen}>
        <div class="drawer-header">
          <button class="drawer-close-btn" onclick={closeDrawerChat} aria-label="关闭侧边栏">✕</button>
        </div>
        <ChatSidebar on:newchat={handleNewChat} on:select={handleSelectChatSession} />
      </div>
    {/if}

    <!-- 移动端/平板端文件侧边栏 Drawer -->
    {#if isMobile || isTablet}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="drawer-overlay"
        class:closed={!drawerFileOpen}
        onclick={closeDrawerFile}
        role="presentation"
      ></div>
      <div class="sidebar-drawer file-drawer" class:closed={!drawerFileOpen}>
        <div class="drawer-header">
          <button class="drawer-close-btn" onclick={closeDrawerFile} aria-label="关闭文件侧边栏">✕</button>
        </div>
        <FileTree on:fileSelect={handleFileSelect} />
        {#if $currentFile}
          <FileHistoryPanel filePath={$currentFile} on:rollback={handleFileSelect} />
        {/if}
      </div>
    {/if}

    <div class="content-pane-group">
      <div class="chat-pane" class:mobile-editor-hidden={isMobile && mobileEditorVisible} style="flex: {chatFlex};">
        <ChatPanel onsend={handleChatSend} onToggleSidebar={handleToggleChatSidebar} />
        {#if $parallelMode}
          {#if ComparisonViewComponent}
            <ComparisonViewComponent />
          {/if}
        {/if}
      </div>
      <button class="resize-handle" class:active={isResizing} onmousedown={handleResizeStart} aria-label={_t('editor.resizeHandle')}></button>
      <div class="editor-pane" class:visible-on-mobile={isMobile && mobileEditorVisible} style="flex: {editorFlex};"><CodeEditor on:tabClose={handleTabClose} on:change={handleEditorChange} on:save={handleSaveFile} /></div>
    </div>
  </div>

  <!-- 移动端/平板端底部导航栏 -->
  {#if isMobile || isTablet}
    <div class="bottom-nav">
      <button
        class="nav-btn"
        class:active={drawerChatOpen}
        onclick={openDrawerChat}
        title="聊天"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span class="nav-label">聊天</span>
      </button>
      <button
        class="nav-btn"
        class:active={drawerFileOpen}
        onclick={openDrawerFile}
        title="文件"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span class="nav-label">文件</span>
      </button>
      <button
        class="nav-btn"
        class:active={mobileEditorVisible}
        onclick={toggleMobileEditor}
        title="编辑器"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        <span class="nav-label">编辑器</span>
      </button>
      <button
        class="nav-btn"
        onclick={() => { showRagPanel = true; }}
        title="知识库"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        <span class="nav-label">知识库</span>
      </button>
    </div>
  {/if}

  <ConfigModal bind:open={showConfigModal} on:close={handleCloseConfig} on:connect={handleConnectModel} />
  <Modal bind:open={showRagPanel} title={_t('rag.title')} width="560px">
    {#if showRagPanel}
      {#if RagPanelComponent}
        <RagPanelComponent />
      {:else}
        <div class="lazy-loading"><span class="dot-pulse"></span></div>
      {/if}
    {/if}
  </Modal>
  <Modal bind:open={showAdminPanel} title={_t('admin.button')} width="800px">
    <div class="admin-tabs">
        <button
          class="admin-tab"
          class:active={adminTab === 'audit'}
          onclick={() => adminTab = 'audit'}
        >{_t('admin.tabAudit')}</button>
        <button
          class="admin-tab"
          class:active={adminTab === 'perf'}
          onclick={() => adminTab = 'perf'}
        >{_t('admin.tabPerf')}</button>
      </div>
    {#if adminTab === 'audit'}
      {#if AuditLogComponent}
        <AuditLogComponent />
      {:else}
        <div class="lazy-loading"><span class="dot-pulse"></span></div>
      {/if}
    {:else}
      {#if PerfDashboardComponent}
        <PerfDashboardComponent />
      {:else}
        <div class="lazy-loading"><span class="dot-pulse"></span></div>
      {/if}
    {/if}
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
  <InstallPrompt />
  <LoginModal show={showLoginModal} onclose={handleCloseLogin} onlogin={handleLoginSuccess} />
  {#if $isAuthenticated}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="user-badge" style="position: fixed; bottom: {isMobile || isTablet ? 'calc(52px + 8px)' : '8px'}; right: 8px; z-index: 999;" role="presentation">
      <button class="toolbar-btn" onclick={() => showUserMenu = !showUserMenu}
        title={$authUser?.username || 'User'}
        style="width: 28px; height: 28px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 50%; font-size: 11px; cursor: pointer; color: var(--text-primary);">
        {$authUser?.username?.charAt(0)?.toUpperCase() || 'U'}
      </button>
      {#if showUserMenu}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="user-menu" onclick={() => showUserMenu = false} onkeydown={() => {}} style="position: absolute; bottom: 36px; right: 0; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 8px; padding: 8px; min-width: 150px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);">
          <div style="padding: 4px 8px; font-size: 13px; color: var(--text-primary);">{$authUser?.username}</div>
          <div style="padding: 4px 8px; font-size: 11px; color: var(--text-dim);">{$authUser?.role}</div>
          <hr style="border: none; border-top: 1px solid var(--border); margin: 6px 0;">
          <button class="link-btn" onclick={handleLogout} style="width: 100%; text-align: left; padding: 6px 8px; font-size: 13px;">注销</button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="login-badge" style="position: fixed; bottom: {isMobile || isTablet ? 'calc(52px + 8px)' : '8px'}; right: 8px; z-index: 999;">
      <button class="toolbar-btn" onclick={handleOpenLogin}
        title="登录 / 注册"
        style="width: 28px; height: 28px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 50%; font-size: 11px; cursor: pointer; color: var(--text-primary);">
        L
      </button>
    </div>
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
  .parallel-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    background: var(--bg-raised, #111);
    border-bottom: 1px solid var(--border, #333);
    flex-wrap: wrap;
  }
  .admin-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border, #333);
    margin-bottom: 16px;
  }
  .admin-tab {
    padding: 8px 20px;
    border: none;
    background: transparent;
    color: var(--text-secondary, #888);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
  }
  .admin-tab:hover {
    color: var(--text-primary, #ccc);
    background: var(--bg-hover, #1a1a2e);
  }
  .admin-tab.active {
    color: var(--accent, #4f8ff7);
    border-bottom-color: var(--accent, #4f8ff7);
  }
  .lazy-loading {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 60px 20px;
  }
  .dot-pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-color, #6c5ce7);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.3; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
  }

  /* === Drawer 侧边栏样式 === */
  .drawer-overlay {
    position: fixed !important;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 199;
    opacity: 1;
    transition: opacity 0.2s ease;
  }
  .drawer-overlay.closed {
    opacity: 0;
    pointer-events: none;
  }
  .sidebar-drawer {
    position: fixed !important;
    top: 0;
    left: 0;
    height: 100%;
    width: 280px;
    background: var(--bg-raised);
    border-right: 1px solid var(--border);
    z-index: 200;
    transform: translateX(0);
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
  }
  .sidebar-drawer.closed {
    transform: translateX(-100%) !important;
  }
  .sidebar-drawer.file-drawer {
    width: 240px;
  }
  .drawer-header {
    display: flex;
    justify-content: flex-end;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .drawer-close-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 4px;
    font-size: 16px;
  }
  .drawer-close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* === 底部导航栏 === */
  .bottom-nav {
    display: none;
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 52px;
    background: var(--bg-raised);
    border-top: 1px solid var(--border);
    z-index: 150;
    justify-content: space-around;
    align-items: center;
    padding: 0 4px;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  /* 手机/平板显示底部导航 */
  @media (max-width: 1023px) {
    .bottom-nav {
      display: flex;
    }
    .app {
      padding-bottom: 52px;
    }
  }
  .nav-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 4px 12px;
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    border-radius: 6px;
    min-width: 56px;
    min-height: 44px;
    transition: all 0.15s;
  }
  .nav-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .nav-btn.active {
    color: var(--amber);
  }
  .nav-label {
    font-size: 10px;
    line-height: 1;
  }

  /* === 移动端编辑器隐藏 === */
  .mobile-editor-hidden {
    display: flex !important;
  }

  /* === 离线指示器 === */
  .offline-banner {
    flex-shrink: 0;
    padding: 6px 16px;
    background: var(--red);
    color: white;
    font-size: 12px;
    text-align: center;
    font-weight: 500;
  }</style>
