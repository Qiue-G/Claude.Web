/**
 * Templates Store — 提示词模板状态管理
 */
import { writable, derived } from 'svelte/store';

export const templates = writable([]);
export const selectedTemplate = writable(null);
export const templateVariables = writable({});

/** 按分类分组的模板 */
export const templatesByCategory = derived(templates, ($templates) => {
  const groups = {};
  for (const t of $templates) {
    if (!groups[t.category]) groups[t.category] = [];
    groups[t.category].push(t);
  }
  return groups;
});

export async function fetchTemplates(locale = 'zh') {
  try {
    const res = await fetch(`/api/templates?locale=${locale}`);
    const data = await res.json();
    templates.set(data.templates || []);
  } catch (e) {
    console.warn('[Templates] fetch failed:', e.message);
  }
}

export function resetTemplate() {
  selectedTemplate.set(null);
  templateVariables.set({});
}
