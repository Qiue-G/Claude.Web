/**
 * Files Store - manages file tree and editor state
 */
import { writable, derived } from 'svelte/store';

export const fileTree = writable([]);
export const fileContents = writable({});
export const currentFile = writable(null);
export const currentFileContent = writable('');
export const openTabs = writable([]);
export const activeTab = writable(null);

export const allFilePaths = derived(fileTree, ($tree) => {
  const paths = [];
  function collect(items) {
    for (const item of items) {
      if (item.type === 'file') paths.push(item.path);
      if (item.children) collect(item.children);
    }
  }
  collect($tree);
  return paths;
});

export function openFile(path, content) {
  fileContents.update(fc => ({ ...fc, [path]: content }));
  currentFile.set(path);
  currentFileContent.set(content);

  openTabs.update(tabs => {
    if (!tabs.includes(path)) return [...tabs, path];
    return tabs;
  });
  activeTab.set(path);
}

export function closeTab(path) {
  openTabs.update(tabs => tabs.filter(t => t !== path));
  activeTab.update(current => {
    if (current === path) return null;
    return current;
  });
  fileContents.update(fc => {
    const copy = { ...fc };
    delete copy[path];
    return copy;
  });
}

export function updateFileContent(path, content) {
  fileContents.update(fc => ({ ...fc, [path]: content }));
  currentFile.update(cf => {
    if (cf === path) currentFileContent.set(content);
    return cf;
  });
}
