<script>
  import Icon from '$components/common/Icon.svelte';
  import { escapeHtml } from '$lib/utils.js';
  import { t } from '$lib/i18n.js';

  $: _t = $t;

  export let code = '';
  export let language = '';

  // 解析结果
  let filePath = '';
  let fileLang = '';
  let content = '';
  let newPath = '';
  let searchStr = '';
  let replaceStr = '';
  let listDir = '';
  let listEntries = [];

  // 解析 write_file 块
  function parseWriteFile(text) {
    const lines = text.split('\n');
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    if (pathIdx === -1) return null;
    const p = lines[pathIdx].slice(5).trim();
    const langIdx = lines.findIndex(l => l.startsWith('language:'));
    const l = langIdx !== -1 ? lines[langIdx].slice(9).trim() : '';
    // 提取 path: 行之后的内容，跳过 language: 行和开头的空行
    const contentStart = pathIdx + 1;
    let rawContent = lines.slice(contentStart).join('\n');
    // 如果 language 行在 path 行之后，再跳过它
    if (langIdx > pathIdx) {
      rawContent = lines.slice(langIdx + 1).join('\n');
    }
    const trimmed = rawContent.replace(/^\n+/, '');
    return { path: p, lang: l, content: trimmed };
  }

  // 解析 edit_file 块
  function parseEditFile(text) {
    const lines = text.split('\n');
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    if (pathIdx === -1) return null;
    const p = lines[pathIdx].slice(5).trim();
    const searchStart = lines.findIndex(l => l.includes('<<<<<<< SEARCH') || l.includes('<<<<<<<'));
    const divider = lines.findIndex(l => l.startsWith('======='));
    const replaceEnd = lines.findIndex(l => l.startsWith('>>>>>>>'));
    if (searchStart === -1 || divider === -1 || replaceEnd === -1) return null;
    const search = lines.slice(searchStart + 1, divider).join('\n').trim();
    const replace = lines.slice(divider + 1, replaceEnd).join('\n').trim();
    return { path: p, search, replace };
  }

  // 解析 delete_file 块
  function parseDeleteFile(text) {
    const m = text.match(/path:\s*(.+)/);
    return m ? m[1].trim() : '';
  }

  // 解析 rename_file 块
  function parseRenameFile(text) {
    const oldM = text.match(/path:\s*(.+)/);
    const newM = text.match(/newPath:\s*(.+)/);
    if (!oldM || !newM) return null;
    return { oldPath: oldM[1].trim(), newPath: newM[1].trim() };
  }

  // 解析 list_files 块
  function parseListFiles(text) {
    const m = text.match(/path:\s*(.+)/);
    return m ? m[1].trim() : '.';
  }

  $: {
    // 每次 code/language 变化重新解析
    filePath = '';
    fileLang = '';
    content = '';
    newPath = '';
    searchStr = '';
    replaceStr = '';
    listDir = '';
    listEntries = [];

    if (!code) {
      // 空 code，所有字段保持默认空值
    } else {
      switch (language) {
      case 'write_file': {
        const result = parseWriteFile(code);
        if (result) {
          filePath = result.path;
          fileLang = result.lang;
          content = result.content;
        }
        break;
      }
      case 'edit_file': {
        const result = parseEditFile(code);
        if (result) {
          filePath = result.path;
          searchStr = result.search;
          replaceStr = result.replace;
        }
        break;
      }
      case 'delete_file': {
        filePath = parseDeleteFile(code);
        break;
      }
      case 'rename_file': {
        const result = parseRenameFile(code);
        if (result) {
          filePath = result.oldPath;
          newPath = result.newPath;
        }
        break;
      }
      case 'list_files': {
        listDir = parseListFiles(code);
        // 将目录列表内容解析为条目
        const lines = code.split('\n').filter(l => l.trim());
        listEntries = lines;
        break;
      }
    }
  }
}

  function getFileIcon() {
    switch (language) {
      case 'write_file': return 'file-plus';
      case 'edit_file': return 'edit';
      case 'delete_file': return 'trash';
      case 'rename_file': return 'move';
      default: return 'file';
    }
  }

  function getStatusLabel() {
    switch (language) {
      case 'write_file': return '写入';
      case 'edit_file': return '编辑';
      case 'delete_file': return '删除';
      case 'rename_file': return '重命名';
      case 'list_files': return '列出';
      default: return '';
    }
  }

  function getStatusClass() {
    switch (language) {
      case 'write_file': return 'status-write';
      case 'edit_file': return 'status-edit';
      case 'delete_file': return 'status-delete';
      case 'rename_file': return 'status-rename';
      case 'list_files': return 'status-list';
      default: return '';
    }
  }
</script>

<div class="file-block {language}">
  <div class="file-block-hdr">
    <span class="file-block-icon">
      {#if language === 'write_file'}
        <span class="icon-file">📄</span>
      {:else if language === 'edit_file'}
        <span class="icon-file">📝</span>
      {:else if language === 'delete_file'}
        <span class="icon-file">🗑️</span>
      {:else if language === 'rename_file'}
        <span class="icon-file">📎</span>
      {:else if language === 'list_files'}
        <span class="icon-file">📂</span>
      {/if}
    </span>
    <span class="file-block-path">
      {#if language === 'rename_file'}
        <span class="old-path">{filePath}</span>
        <span class="arrow">→</span>
        <span class="new-path">{newPath}</span>
      {:else if language === 'list_files'}
        <span class="dir-path">{listDir === '.' ? '/' : listDir}</span>
      {:else}
        {filePath}
      {/if}
    </span>
    <span class="file-block-status {getStatusClass()}">{getStatusLabel()}</span>
  </div>

  <div class="file-block-body">
    {#if language === 'write_file' && content}
      {#if fileLang}
        <div class="file-meta-lang">{fileLang}</div>
      {/if}
      <pre class="file-content"><code>{escapeHtml(content)}</code></pre>
    {:else if language === 'edit_file' && searchStr}
      <div class="diff-section">
        <div class="diff-label removed-label">旧内容</div>
        <pre class="diff-content removed"><code>{escapeHtml(searchStr)}</code></pre>
        <div class="diff-label added-label">新内容</div>
        <pre class="diff-content added"><code>{escapeHtml(replaceStr)}</code></pre>
      </div>
    {:else if language === 'list_files'}
      <div class="list-entries">
        {#each listEntries as entry}
          <div class="list-entry">{entry}</div>
        {/each}
      </div>
    {:else}
      <pre class="file-content"><code>{escapeHtml(code)}</code></pre>
    {/if}
  </div>
</div>

<style>
  .file-block {
    margin: 10px 0;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--bg-code);
  }

  .file-block-hdr {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }

  .file-block-icon {
    font-size: 16px;
    line-height: 1;
    flex-shrink: 0;
  }

  .file-block-path {
    flex: 1;
    font-family: var(--font-mono);
    color: var(--text-primary);
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .old-path {
    color: var(--red, #ef4444);
    text-decoration: line-through;
    opacity: 0.7;
  }

  .arrow {
    margin: 0 6px;
    color: var(--text-dim);
  }

  .new-path {
    color: var(--green, #22c55e);
  }

  .file-block-status {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }

  .status-write {
    background: rgba(34, 197, 94, 0.15);
    color: var(--green, #22c55e);
  }

  .status-edit {
    background: rgba(59, 130, 246, 0.15);
    color: var(--blue, #3b82f6);
  }

  .status-delete {
    background: rgba(239, 68, 68, 0.15);
    color: var(--red, #ef4444);
  }

  .status-rename {
    background: rgba(168, 85, 247, 0.15);
    color: #a855f7;
  }

  .status-list {
    background: rgba(234, 179, 8, 0.15);
    color: #eab308;
  }

  .file-block-body {
    padding: 8px 12px;
  }

  .file-meta-lang {
    display: inline-block;
    font-size: 10px;
    color: var(--text-dim);
    background: rgba(255, 255, 255, 0.05);
    padding: 1px 6px;
    border-radius: 3px;
    margin-bottom: 6px;
    font-family: var(--font-mono);
  }

  pre.file-content {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    overflow-x: auto;
    color: var(--text-secondary);
  }

  pre.file-content code {
    font-family: inherit;
  }

  .diff-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .diff-label {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 3px;
    display: inline-block;
    width: fit-content;
    font-family: var(--font-mono);
  }

  .removed-label {
    background: rgba(239, 68, 68, 0.1);
    color: var(--red, #ef4444);
  }

  .added-label {
    background: rgba(34, 197, 94, 0.1);
    color: var(--green, #22c55e);
  }

  pre.diff-content {
    margin: 0;
    padding: 8px 12px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    overflow-x: auto;
  }

  pre.diff-content.removed {
    background: rgba(239, 68, 68, 0.05);
    border-left: 3px solid var(--red, #ef4444);
    color: var(--text-secondary);
  }

  pre.diff-content.added {
    background: rgba(34, 197, 94, 0.05);
    border-left: 3px solid var(--green, #22c55e);
    color: var(--text-secondary);
  }

  .list-entries {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .list-entry {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
    padding: 1px 0;
  }

  .list-entry::before {
    content: '';
    margin-right: 8px;
  }
</style>
