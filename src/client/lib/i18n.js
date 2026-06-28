/**
 * Internationalization (i18n) utilities
 */
import { writable, derived } from 'svelte/store';

const translations = {
  zh: {
    // 通用
    'common.save': '保存',
    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.delete': '删除',
    'common.edit': '编辑',
    'common.close': '关闭',
    'common.loading': '加载中...',
    'common.success': '成功',
    'common.error': '错误',
    'common.warning': '警告',
    'common.info': '信息',
    'common.add': '添加',
    'common.remove': '删除',
    'common.reset': '重置',
    'common.search': '搜索',
    'common.copy': '复制',
    'common.copied': '已复制',
    'common.retry': '重试',
    'common.new': '新建',
    'common.noResults': '无结果',

    // 连接状态
    'status.connected': '已连接',
    'status.connecting': '连接中',
    'status.reconnecting': '重连中',
    'status.disconnected': '未连接',
    'status.error': '连接错误',
    'status.reconnectingMsg': '连接断开，{seconds}秒后尝试重连 ({attempt}/{max})...',
    'status.reconnected': '连接已恢复',

    // 聊天
    'chat.new': '新对话',
    'chat.send': '发送',
    'chat.sending': '发送中...',
    'chat.placeholder': '输入消息... (Enter 发送, Shift+Enter 换行)',
    'chat.timeout': '响应超时，请重试',
    'chat.attachFile': '附加文件',
    'chat.sendFailed': '发送失败：WebSocket 连接不可用，请刷新页面重试',
    'chat.confirmDeleteSession': '确定要删除会话',
    'chat.copy': '复制',
    'chat.copied': '已复制',
    'chat.retry': '重试',
    'chat.edit': '编辑',
    'chat.clear': '清空对话',
    'chat.welcome': '欢迎使用 Free Code',
    'chat.suggestion1': '帮我创建一个 React 项目',
    'chat.suggestion2': '解释当前项目结构',
    'chat.suggestion3': '帮我修复一个 bug',
    'chat.suggestion4': '查看帮助',
    'chat.noMessages': '暂无对话历史',
    'chat.startHint': '点击"新对话"开始',
    'chat.helpful': '有帮助',
    'chat.needsImprovement': '需要改进',
    'chat.inputPlaceholder': '消息输入框',

    // 文件
    'files.title': '文件',
    'files.refresh': '刷新',
    'files.newFile': '新建文件',
    'files.newFolder': '新建文件夹',
    'files.delete': '删除',
    'files.rename': '重命名',
    'files.noFiles': '暂无文件',

    // 编辑器
    'editor.noFile': '未打开文件',
    'editor.save': '保存',
    'editor.resizeHandle': '调整编辑器高度',

    // 模型
    'model.select': '选择模型',
    'model.configure': '配置模型',
    'model.add': '添加模型',
    'model.name': '模型名称',
    'model.apiKey': 'API Key',
    'model.baseUrl': 'Base URL',
    'model.manage': '管理模型',
    'model.provider': '服务商',
    'model.modelId': '模型 ID',
    'model.available': '可用模型',
    'model.noModels': '暂无模型',
    'model.addModel': '添加模型',
    'model.switch': '切换',
    'model.edit': '编辑',
    'model.delete': '删除',
    'model.using': '使用中',
    'model.connecting': '连接中',
    'model.confirmDelete': '确定要删除模型',
    'model.parameters': '参数',
    'model.resetParams': '重置为默认值',
    'model.temperature': 'Temperature',
    'model.topP': 'Top P',
    'model.maxTokens': 'Max Tokens',
    'model.frequencyPenalty': 'Frequency Penalty',
    'model.presencePenalty': 'Presence Penalty',
    'model.temperatureDesc': '控制输出的随机性。较高的值使输出更随机。',
    'model.topPDesc': '核采样参数。较低的值使输出更集中。',
    'model.maxTokensDesc': '生成的最大 token 数量。',
    'model.frequencyPenaltyDesc': '根据频率惩罚重复的 token。',
    'model.presencePenaltyDesc': '鼓励讨论新话题。',
    'model.topK': 'Top K',
    'model.topKDesc': '从概率最高的 K 个 token 中采样。值越大输出越多样。',
    'model.seed': '随机种子',
    'model.seedDesc': '设置种子后相同输入会产生相同输出。留空表示随机。',
    'model.stop': '停止序列',
    'model.stopDesc': '遇到此字符串时停止生成。多条用逗号分隔。',
    'model.stream': '流式响应',
    'model.streamDesc': '实时逐字返回响应，类似打字机效果。',

    // 时间
    'time.justNow': '刚刚',
    'time.minuteAgo': '1分钟前',
    'time.minutesAgo': '{n}分钟前',
    'time.hourAgo': '1小时前',
    'time.hoursAgo': '{n}小时前',
    'time.dayAgo': '1天前',
    'time.daysAgo': '{n}天前',

    // 主题
    'theme.dark': '深色',
    'theme.light': '浅色',
    'theme.system': '系统',
    'theme.toggle': '切换主题',

    // 语言
    'language.select': '选择语言',
    'language.zh': '中文',
    'language.en': 'English',

    // 命令
    'command.newChat': '新建对话',
    'command.newChatDesc': '创建一个新的对话',
    'command.toggleSidebar': '切换侧边栏',
    'command.toggleSidebarDesc': '显示或隐藏文件侧边栏',
    'command.toggleChatSidebar': '切换对话侧边栏',
    'command.toggleChatSidebarDesc': '显示或隐藏对话历史侧边栏',
    'command.closeChatSidebar': '关闭对话侧边栏',
    'command.clearChat': '清空对话',
    'command.clearChatDesc': '清空当前对话的所有消息',
    'command.focusInput': '聚焦输入框',
    'command.focusInputDesc': '将焦点移动到消息输入框',
    'command.toggleTheme': '切换主题',
    'command.toggleThemeDesc': '在深色和浅色主题之间切换',
    'command.search': '输入命令名称或描述...',
    'command.noResults': '未找到匹配的命令',

    // 提示
    'toast.copied': '已复制到剪贴板',
    'toast.saved': '保存成功',
    'toast.deleted': '删除成功',
    'toast.error': '操作失败',
    'toast.connected': '已连接到',
    'toast.connectionFailed': '连接失败',
    'toast.newChatCreated': '新对话已创建',
    'toast.themeSwitched': '主题已切换',

    // 确认
    'confirm.deleteSession': '确定要删除',
    'confirm.deleteModel': '确定要删除模型',

    // 工具控制
    'controls.title': 'Tools & Skills',
    'controls.hint': '启用/禁用工具，模型将在对话中使用启用的工具。',
    'controls.warning': '工具状态加载失败，已使用本地默认配置。',
    'controls.unconfigured': '未配置',

    // 工具审批
    'approval.title': '工具调用审批',
    'approval.subtitle': 'AI 请求调用以下工具，请选择允许执行的工具：',
    'approval.rejectAll': '全部拒绝',
    'approval.allow': '允许选中的',

    // 搜索
    'search.header': '搜索',
    'search.searching': '搜索中...',
    'search.found': '找到 {n} 个',

    // 代码
    'code.lines': '{n} 行',

    // 文件上传
    'files.dropToUpload': '松开以上传文件',

    // 工具栏
    'toolbar.tokens': 'Tokens',
    'toolbar.tokenUsage': 'Token 使用情况',

    // 通用提示
    'toast.fileSaved': '文件已保存: {path}',
    'toast.fileSaveFailed': '保存失败: {error}',
    'toast.fileOpenFailed': '打开文件失败: {error}',
    'toast.noFileToSave': '没有文件可保存',
    'toast.newChatCreated': '新对话已创建',
    'toast.connected': '已连接到',
    'toast.connectionFailed': '连接失败',
    'toast.reconnected': '已恢复连接',
    'toast.sessionExpired': '连接已过期，点击模型重新连接',
    'toast.clickToConnect': '点击「{name}」连接模型',

    // 系统消息
    'system.connectFirst': '请先连接模型',
    'system.filesAttached': '[已附加文件]',
    'system.containsImages': '[包含图片]',

    // 配置表单占位
    'config.modelExample': '例如：Claude Sonnet 4',
    'config.selectModelId': '选择或输入模型 ID',
    'config.enterModelId': '输入模型 ID',
    'config.enterApiKey': '输入 API Key',
  },

  en: {
    // Common
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.close': 'Close',
    'common.loading': 'Loading...',
    'common.success': 'Success',
    'common.error': 'Error',
    'common.warning': 'Warning',
    'common.info': 'Info',
    'common.add': 'Add',
    'common.remove': 'Remove',
    'common.reset': 'Reset',
    'common.search': 'Search',
    'common.copy': 'Copy',
    'common.copied': 'Copied',
    'common.retry': 'Retry',
    'common.new': 'New',
    'common.noResults': 'No results',

    // Connection Status
    'status.connected': 'Connected',
    'status.connecting': 'Connecting',
    'status.reconnecting': 'Reconnecting',
    'status.disconnected': 'Disconnected',
    'status.error': 'Connection Error',
    'status.reconnectingMsg': 'Connection lost, retrying in {seconds}s ({attempt}/{max})...',
    'status.reconnected': 'Connection restored',

    // Chat
    'chat.new': 'New Chat',
    'chat.send': 'Send',
    'chat.sending': 'Sending...',
    'chat.placeholder': 'Type a message... (Enter to send, Shift+Enter for new line)',
    'chat.timeout': 'Response timed out, please try again',
    'chat.sendFailed': 'Send failed: WebSocket connection unavailable, please refresh the page',
    'chat.attachFile': 'Attach File',
    'chat.confirmDeleteSession': 'Are you sure you want to delete session',
    'chat.copy': 'Copy',
    'chat.copied': 'Copied',
    'chat.retry': 'Retry',
    'chat.edit': 'Edit',
    'chat.clear': 'Clear Chat',
    'chat.welcome': 'Welcome to Free Code',
    'chat.suggestion1': 'Help me create a React project',
    'chat.suggestion2': 'Explain the current project structure',
    'chat.suggestion3': 'Help me fix a bug',
    'chat.suggestion4': 'View help',
    'chat.noMessages': 'No chat history',
    'chat.startHint': 'Click "New Chat" to start',
    'chat.helpful': 'Helpful',
    'chat.needsImprovement': 'Needs Improvement',
    'chat.inputPlaceholder': 'Message input box',

    // Files
    'files.title': 'Files',
    'files.refresh': 'Refresh',
    'files.newFile': 'New File',
    'files.newFolder': 'New Folder',
    'files.delete': 'Delete',
    'files.rename': 'Rename',
    'files.noFiles': 'No files',

    // Editor
    'editor.noFile': 'No file open',
    'editor.save': 'Save',
    'editor.resizeHandle': 'Resize Editor',

    // Model
    'model.select': 'Select Model',
    'model.configure': 'Configure Model',
    'model.add': 'Add Model',
    'model.name': 'Model Name',
    'model.apiKey': 'API Key',
    'model.baseUrl': 'Base URL',
    'model.manage': 'Manage Models',
    'model.provider': 'Provider',
    'model.modelId': 'Model ID',
    'model.available': 'Available Models',
    'model.noModels': 'No models',
    'model.addModel': 'Add Model',
    'model.switch': 'Switch',
    'model.edit': 'Edit',
    'model.delete': 'Delete',
    'model.using': 'In Use',
    'model.connecting': 'Connecting',
    'model.confirmDelete': 'Are you sure you want to delete the model',
    'model.parameters': 'Parameters',
    'model.resetParams': 'Reset to defaults',
    'model.temperature': 'Temperature',
    'model.topP': 'Top P',
    'model.maxTokens': 'Max Tokens',
    'model.frequencyPenalty': 'Frequency Penalty',
    'model.presencePenalty': 'Presence Penalty',
    'model.temperatureDesc': 'Controls randomness. Higher values make output more random.',
    'model.topPDesc': 'Nucleus sampling. Lower values make output more focused.',
    'model.maxTokensDesc': 'Maximum number of tokens to generate.',
    'model.frequencyPenaltyDesc': 'Penalize repeated tokens based on frequency.',
    'model.presencePenaltyDesc': 'Encourage new topics.',
    'model.topK': 'Top K',
    'model.topKDesc': 'Sample from the top K most likely tokens. Higher values produce more diverse output.',
    'model.seed': 'Seed',
    'model.seedDesc': 'Same seed produces the same output for the same input. Leave empty for random.',
    'model.stop': 'Stop Sequences',
    'model.stopDesc': 'Stop generation when this string is encountered. Separate multiple with commas.',
    'model.stream': 'Stream',
    'model.streamDesc': 'Stream the response in real-time, like a typewriter.',

    // Time
    'time.justNow': 'Just now',
    'time.minuteAgo': '1 minute ago',
    'time.minutesAgo': '{n} minutes ago',
    'time.hourAgo': '1 hour ago',
    'time.hoursAgo': '{n} hours ago',
    'time.dayAgo': '1 day ago',
    'time.daysAgo': '{n} days ago',

    // Theme
    'theme.dark': 'Dark',
    'theme.light': 'Light',
    'theme.system': 'System',
    'theme.toggle': 'Toggle Theme',

    // Language
    'language.select': 'Select Language',
    'language.zh': '中文',
    'language.en': 'English',

    // Command
    'command.newChat': 'New Chat',
    'command.newChatDesc': 'Create a new chat',
    'command.toggleSidebar': 'Toggle Sidebar',
    'command.toggleSidebarDesc': 'Show or hide the file sidebar',
    'command.toggleChatSidebar': 'Toggle Chat Sidebar',
    'command.toggleChatSidebarDesc': 'Show or hide the chat history sidebar',
    'command.closeChatSidebar': 'Close Chat Sidebar',
    'command.clearChat': 'Clear Chat',
    'command.clearChatDesc': 'Clear all messages in the current chat',
    'command.focusInput': 'Focus Input',
    'command.focusInputDesc': 'Move focus to the message input',
    'command.toggleTheme': 'Toggle Theme',
    'command.toggleThemeDesc': 'Switch between dark and light themes',
    'command.search': 'Type a command name or description...',
    'command.noResults': 'No matching commands found',

    // Toast
    'toast.copied': 'Copied to clipboard',
    'toast.saved': 'Saved successfully',
    'toast.deleted': 'Deleted successfully',
    'toast.error': 'Operation failed',
    'toast.connected': 'Connected to',
    'toast.connectionFailed': 'Connection failed',
    'toast.newChatCreated': 'New chat created',
    'toast.themeSwitched': 'Theme switched',

    // Confirm
    'confirm.deleteSession': 'Are you sure you want to delete',
    'confirm.deleteModel': 'Are you sure you want to delete the model',

    // Tool Controls
    'controls.title': 'Tools & Skills',
    'controls.hint': 'Enable or disable tools. Enabled tools will be available to the model.',
    'controls.warning': 'Failed to load tool states, using local defaults.',
    'controls.unconfigured': 'Not configured',

    // Tool Approval
    'approval.title': 'Tool Approval',
    'approval.subtitle': 'AI requests to use the following tools. Select which to allow:',
    'approval.rejectAll': 'Reject All',
    'approval.allow': 'Allow Selected',

    // Search
    'search.header': 'Search',
    'search.searching': 'Searching...',
    'search.found': '{n} found',

    // Code
    'code.lines': '{n} lines',

    // File upload
    'files.dropToUpload': 'Release to upload files',

    // Toolbar
    'toolbar.tokens': 'Tokens',
    'toolbar.tokenUsage': 'Token Usage',

    // Toast
    'toast.fileSaved': 'File saved: {path}',
    'toast.fileSaveFailed': 'Save failed: {error}',
    'toast.fileOpenFailed': 'Failed to open file: {error}',
    'toast.noFileToSave': 'No file to save',
    'toast.reconnected': 'Connection restored',
    'toast.sessionExpired': 'Session expired, click the model to reconnect',
    'toast.clickToConnect': 'Click "{name}" to connect',

    // System messages
    'system.connectFirst': 'Please connect a model first',
    'system.filesAttached': '[Files attached]',
    'system.containsImages': '[Images attached]',

    // Config form placeholders
    'config.modelExample': 'e.g. Claude Sonnet 4',
    'config.selectModelId': 'Select or enter model ID',
    'config.enterModelId': 'Enter model ID',
    'config.enterApiKey': 'Enter API Key',
  }
};

function getInitialLocale() {
  if (typeof window === 'undefined') return 'zh';
  try {
    const saved = localStorage.getItem('locale');
    if (saved && translations[saved]) {
      return saved;
    }
  } catch {}
  return 'zh';
}

// 响应式语言 store
export const currentLocale = writable(getInitialLocale());

// 保存语言偏好
currentLocale.subscribe((value) => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('locale', value);
    } catch {}
  }
});

export function setLocale(locale) {
  if (translations[locale]) {
    currentLocale.set(locale);
  }
}

export function getLocale() {
  let value = 'zh';
  currentLocale.subscribe(v => value = v)();
  return value;
}

// 派生翻译函数 - 组件中使用 $t('key') 自动解包
// 支持插值：$t('key', { name: 'value' }) 替换 {name}
export const t = derived(currentLocale, ($locale) => {
  return (key, params) => {
    let str = translations[$locale]?.[key] || translations.zh[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(`{${k}}`, v);
      }
    }
    return str;
  };
});
