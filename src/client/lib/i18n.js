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

    // 聊天
    'chat.new': '新对话',
    'chat.send': '发送',
    'chat.placeholder': '输入消息... (Enter 发送, Shift+Enter 换行)',
    'chat.attachFile': '附加文件',
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

    // Chat
    'chat.new': 'New Chat',
    'chat.send': 'Send',
    'chat.placeholder': 'Type a message... (Enter to send, Shift+Enter for new line)',
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
// 这样语言切换时所有使用 $t 的组件自动重新渲染
export const t = derived(currentLocale, ($locale) => {
  return (key) => translations[$locale]?.[key] || translations.zh[key] || key;
});
