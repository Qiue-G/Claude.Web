<script>
  import Icon from '$components/common/Icon.svelte';

  export let toolName = '';
  export let toolInput = null;
  export let status = 'running'; // 'running' | 'success' | 'error'
  export let result = '';
  export let error = '';

  $: iconMap = {
    write_file: 'file',
    edit_file: 'edit',
    delete_file: 'trash',
    rename_file: 'move',
    list_files: 'folder',
    read_file: 'file',
    glob: 'search',
    grep: 'search',
    todo_write: 'list',
    execute_python: 'code',
    web_search: 'globe',
    image_generation: 'image',
    file_analysis: 'file',
    rag_search: 'database',
  };

  $: labelMap = {
    write_file: 'Write File',
    edit_file: 'Edit File',
    delete_file: 'Delete File',
    rename_file: 'Rename File',
    list_files: 'List Files',
    read_file: 'Read File',
    glob: 'Glob',
    grep: 'Grep',
    todo_write: 'Todo',
    execute_python: 'Execute Python',
    web_search: 'Web Search',
    image_generation: 'Image Generation',
    file_analysis: 'File Analysis',
    rag_search: 'RAG Search',
  };

  $: icon = iconMap[toolName] || 'code';
  $: label = labelMap[toolName] || toolName;

  // 提取文件名（从 write_file/edit_file 的 input 中）
  $: fileName = (() => {
    if (!toolInput) return '';
    if (typeof toolInput === 'string') return toolInput;
    if (toolInput.path) return toolInput.path;
    if (toolInput.file_path) return toolInput.file_path;
    if (toolInput.file) return toolInput.file;
    return '';
  })();

  $: isRunning = status === 'running';
  $: isSuccess = status === 'success';
  $: isError = status === 'error';

  let expanded = false;

  function toggleExpand() {
    expanded = !expanded;
  }
</script>

<div class="tool-call-card" class:running={isRunning} class:success={isSuccess} class:error={isError}>
  <div class="tool-call-header" onclick={toggleExpand} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleExpand(); }}>
    <div class="tool-call-left">
      {#if isRunning}
        <span class="spinner" />
      {:else if isSuccess}
        <Icon name="check" size="sm" class="status-icon success-icon" />
      {:else if isError}
        <Icon name="x" size="sm" class="status-icon error-icon" />
      {/if}
      <Icon name={icon} size="sm" class="tool-icon" />
      <span class="tool-label">{label}</span>
      {#if fileName}
        <span class="tool-file">{fileName}</span>
      {/if}
    </div>
    {#if result && !isRunning}
      <span class="tool-expand-hint">{expanded ? '收起' : '详情'}</span>
    {/if}
  </div>

  {#if expanded && result}
    <div class="tool-call-body">
      <pre class="tool-result">{result}</pre>
    </div>
  {/if}

  {#if expanded && isError && error}
    <div class="tool-call-body error-body">
      <pre class="tool-result">{error}</pre>
    </div>
  {/if}
</div>

<style>
  .tool-call-card {
    display: flex;
    flex-direction: column;
    margin: 4px 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-raised);
    overflow: hidden;
    transition: border-color 0.2s ease;
  }

  .tool-call-card.running {
    border-color: var(--amber, #f59e0b);
  }

  .tool-call-card.success {
    border-color: var(--green, #22c55e);
  }

  .tool-call-card.error {
    border-color: var(--red, #ef4444);
  }

  .tool-call-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    cursor: pointer;
    user-select: none;
    gap: 8px;
  }

  .tool-call-header:hover {
    background: var(--bg-hover);
  }

  .tool-call-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--border);
    border-top-color: var(--amber, #f59e0b);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .status-icon {
    flex-shrink: 0;
  }

  .success-icon {
    color: var(--green, #22c55e);
  }

  .error-icon {
    color: var(--red, #ef4444);
  }

  .tool-icon {
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .tool-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .tool-file {
    font-size: 12px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }

  .tool-expand-hint {
    font-size: 11px;
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .tool-call-body {
    border-top: 1px solid var(--border);
    padding: 8px 12px;
    max-height: 200px;
    overflow-y: auto;
  }

  .error-body {
    border-top-color: var(--red, #ef4444);
  }

  .tool-result {
    margin: 0;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
