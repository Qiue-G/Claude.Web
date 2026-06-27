/**
 * Toast Store - manages toast notifications
 */
import { writable } from 'svelte/store';

export const toasts = writable([]);

let toastId = 0;
let timeoutIds = new Map();

export function addToast(message, type = 'info', duration = 3000) {
  const id = toastId++;
  toasts.update(all => [...all, { id, message, type, duration, dismissing: false }]);

  if (duration > 0) {
    const timerId = setTimeout(() => dismissToast(id), duration);
    timeoutIds.set(id, timerId);
  }
}

export function dismissToast(id) {
  // 清除对应的定时器
  if (timeoutIds.has(id)) {
    clearTimeout(timeoutIds.get(id));
    timeoutIds.delete(id);
  }
  // 标记为正在退出，触发退出动画
  toasts.update(all => all.map(t => t.id === id ? { ...t, dismissing: true } : t));
  // 动画结束后真正移除
  const timerId = setTimeout(() => removeToast(id), 250);
  timeoutIds.set(id, timerId);
}

export function removeToast(id) {
  toasts.update(all => all.filter(t => t.id !== id));
  if (timeoutIds.has(id)) {
    clearTimeout(timeoutIds.get(id));
    timeoutIds.delete(id);
  }
}

export function clearAllToasts() {
  // 清除所有定时器
  timeoutIds.forEach(timerId => clearTimeout(timerId));
  timeoutIds.clear();
  toasts.set([]);
}

export function success(message, duration = 3000) {
  addToast(message, 'success', duration);
}

export function error(message, duration = 4000) {
  addToast(message, 'error', duration);
}

export function info(message, duration = 3000) {
  addToast(message, 'info', duration);
}

export function warning(message, duration = 3500) {
  addToast(message, 'warning', duration);
}

// 别名：兼容 ui.store 的旧导入
export { addToast as showToast, clearAllToasts as clearToasts };
