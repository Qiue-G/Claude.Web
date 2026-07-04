/**
 * Collaboration store — 管理多人协作状态。
 *
 * - onlineUsers: 当前 session 的在线用户列表
 * - collabClient: CollabClient 实例（用于外部控制）
 */
import { writable } from 'svelte/store';

/** @type {import('svelte/store').Writable<Array<{clientId: string, username?: string, color?: string, lastActivity?: number}>>} */
export const onlineUsers = writable([]);

/** @type {import('svelte/store').Writable<import('../lib/collab.js').CollabClient|null>} */
export const collabClient = writable(null);
