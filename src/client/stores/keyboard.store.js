/**
 * Keyboard Shortcuts Store
 * 管理快捷键状态和命令面板
 */
import { writable, derived, get } from 'svelte/store';

// 命令面板是否打开
export const isCommandPaletteOpen = writable(false);

// 命令列表（使用 i18n key，由 CommandPalette 组件翻译）
export const commands = writable([
  {
    id: 'new-chat',
    nameKey: 'command.newChat',
    name: '新建对话',
    descriptionKey: 'command.newChatDesc',
    description: '创建一个新的对话',
    shortcut: 'Ctrl+Shift+N',
    action: () => {
      window.dispatchEvent(new CustomEvent('command:new-chat'));
    }
  },
  {
    id: 'toggle-sidebar',
    nameKey: 'command.toggleSidebar',
    name: '切换侧边栏',
    descriptionKey: 'command.toggleSidebarDesc',
    description: '显示或隐藏文件侧边栏',
    shortcut: 'Ctrl+B',
    action: () => {
      window.dispatchEvent(new CustomEvent('command:toggle-sidebar'));
    }
  },
  {
    id: 'toggle-chat-sidebar',
    nameKey: 'command.toggleChatSidebar',
    name: '切换对话侧边栏',
    descriptionKey: 'command.toggleChatSidebarDesc',
    description: '显示或隐藏对话历史侧边栏',
    shortcut: 'Ctrl+Shift+B',
    action: () => {
      window.dispatchEvent(new CustomEvent('command:toggle-chat-sidebar'));
    }
  },
  {
    id: 'clear-chat',
    nameKey: 'command.clearChat',
    name: '清空对话',
    descriptionKey: 'command.clearChatDesc',
    description: '清空当前对话的所有消息',
    shortcut: 'Ctrl+Shift+L',
    action: () => {
      window.dispatchEvent(new CustomEvent('command:clear-chat'));
    }
  },
  {
    id: 'focus-input',
    nameKey: 'command.focusInput',
    name: '聚焦输入框',
    descriptionKey: 'command.focusInputDesc',
    description: '将焦点移动到消息输入框',
    shortcut: 'Ctrl+I',
    action: () => {
      window.dispatchEvent(new CustomEvent('command:focus-input'));
    }
  },
  {
    id: 'toggle-theme',
    nameKey: 'command.toggleTheme',
    name: '切换主题',
    descriptionKey: 'command.toggleThemeDesc',
    description: '在深色和浅色主题之间切换',
    shortcut: 'Ctrl+Shift+T',
    action: () => {
      window.dispatchEvent(new CustomEvent('command:toggle-theme'));
    }
  }
]);

// 打开命令面板
export function openCommandPalette() {
  isCommandPaletteOpen.set(true);
}

// 关闭命令面板
export function closeCommandPalette() {
  isCommandPaletteOpen.set(false);
}

// 切换命令面板
export function toggleCommandPalette() {
  isCommandPaletteOpen.update(open => !open);
}

// 执行命令
export function executeCommand(commandId) {
  // 使用 get 获取当前值，而不是 update
  let targetCmd = null;
  const unsubscribe = commands.subscribe(cmds => {
    targetCmd = cmds.find(c => c.id === commandId);
  });
  unsubscribe();
  
  if (targetCmd && targetCmd.action) {
    targetCmd.action();
  }
  closeCommandPalette();
}
