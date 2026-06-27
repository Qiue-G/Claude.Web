// UI Store - 全局 UI 状态管理
// 侧边栏、面板等显示状态。Toast 功能请使用 toast.store。
import { writable } from 'svelte/store';

// 统一 Toast 入口：toast.store 是唯一实现，以下为兼容旧导入的重导出
export { toasts, showToast, dismissToast, clearToasts } from './toast.store.js';

// 侧边栏显示状态
export const chatSidebarOpen = writable(true);
export const fileSidebarOpen = writable(true);

// 各种面板/模态框显示状态
export const commandPaletteOpen = writable(false);
export const paramsPanelOpen = writable(false);
export const controlsPanelOpen = writable(false);

// 切换侧边栏
export function toggleChatSidebar() {
  chatSidebarOpen.update(v => !v);
}

export function toggleFileSidebar() {
  fileSidebarOpen.update(v => !v);
}

// 打开/关闭命令面板
export function openCommandPalette() {
  commandPaletteOpen.set(true);
}

export function closeCommandPalette() {
  commandPaletteOpen.set(false);
}

// 打开/关闭参数面板
export function openParamsPanel() {
  paramsPanelOpen.set(true);
}

export function closeParamsPanel() {
  paramsPanelOpen.set(false);
}

export function toggleParamsPanel() {
  paramsPanelOpen.update(v => !v);
}

// 打开/关闭控制面板
export function openControlsPanel() {
  controlsPanelOpen.set(true);
}

export function closeControlsPanel() {
  controlsPanelOpen.set(false);
}
