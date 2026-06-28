<script>
  import CodeBlock from './CodeBlock.svelte';
  import Icon from '$components/common/Icon.svelte';
  import { escapeHtml, formatFileSize } from '$lib/utils.js';
  import { t } from '$lib/i18n.js';
  import { marked } from 'marked';

  marked.setOptions({
    breaks: true,
    gfm: true
  });

  let {
    role = 'user',
    content = '',
    time = '',
    streaming = false,
    messageId = null,
    rating = null,
    files = null,
    onedit = null,
    onretry = null,
    onrate = null,
    ondelete = null
  } = $props();

  let copied = $state(false);

  let roleLabel = $derived(role === 'user' ? 'You' : role === 'assistant' ? 'Assistant' : 'System');
  let parsedParts = $derived(parseContent(content));

  function parseContent(text) {
    const parts = [];
    const regex = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'markdown', content: text.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'code', language: match[1], content: match[2].trim() });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push({ type: 'markdown', content: text.slice(lastIndex) });
    }

    return parts;
  }

  function renderMarkdown(text) {
    if (streaming) {
      return escapeHtml(text);
    }
    const safeText = escapeHtml(text);
    return marked.parse(safeText);
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
      setTimeout(() => copied = false, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  function editMessage() {
    onedit?.({ id: messageId, content });
  }

  function retryMessage() {
    onretry?.({ id: messageId });
  }

  function deleteMsg() {
    ondelete?.({ id: messageId });
  }

  function rateMessage(direction) {
    onrate?.({ id: messageId, rating: rating === direction ? null : direction });
  }
</script>

<div class="chat-msg {role}" class:streaming>
  <div class="chat-msg-header">
    <span class="chat-msg-role">{roleLabel}</span>
    {#if time}
      <span class="chat-msg-time">{time}</span>
    {/if}
  </div>
  <div class="chat-msg-body">
    {#if files && files.length > 0}
      <div class="file-attachments">
        {#each files as file}
          <div class="file-attachment">
            <Icon name="paperclip" size="sm" />
            <span class="file-name">{file.name}</span>
            {#if file.size}
              <span class="file-size">{formatFileSize(file.size)}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    {#each parsedParts as part}
      {#if part.type === 'code'}
        <CodeBlock code={part.content} language={part.language} />
      {:else}
        <div class="markdown-content" class:streaming-cursor={streaming && part.type === 'markdown'}>
          {@html renderMarkdown(part.content)}
        </div>
      {/if}
    {/each}
  </div>
  {#if role !== 'system' && !streaming}
    <div class="chat-msg-actions">
      <button class="action-btn" onclick={copyMessage} title={$t('common.copy')}>
        <Icon name={copied ? 'check' : 'copy'} size="sm" />
        {$t(copied ? 'common.copied' : 'common.copy')}
      </button>
      {#if role === 'user'}
        <button class="action-btn" onclick={editMessage} title={$t('common.edit')}>
          <Icon name="edit" size="sm" />
          {$t('common.edit')}
        </button>
      {/if}
      {#if role === 'assistant'}
        <button class="action-btn" onclick={retryMessage} title={$t('common.retry')}>
          <Icon name="refresh" size="sm" />
          {$t('common.retry')}
        </button>
        <button
          class="action-btn rating-btn"
          class:active={rating === 'up'}
          onclick={() => rateMessage('up')}
          title={$t('chat.helpful')}
        >
          <Icon name="thumbsUp" size="sm" />
        </button>
        <button
          class="action-btn rating-btn"
          class:active={rating === 'down'}
          onclick={() => rateMessage('down')}
          title={$t('chat.needsImprovement')}
        >
          <Icon name="thumbsDown" size="sm" />
        </button>
      {/if}
      {#if role !== 'system'}
        <button class="action-btn delete-btn" onclick={deleteMsg} title={$t('common.delete')}>
          <Icon name="trash" size="sm" />
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chat-msg {
    padding: 12px 24px;
    animation: msgFadeUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  .chat-msg-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .chat-msg-role {
    font-size: 12px;
    font-weight: 600;
  }

  .user .chat-msg-role { color: var(--text-primary); }
  .assistant .chat-msg-role { color: var(--amber); }
  .system .chat-msg-role { color: var(--text-dim); }

  .chat-msg-time {
    font-size: 11px;
    color: var(--text-dim);
  }

  .chat-msg-body {
    font-size: 14px;
    line-height: 1.7;
    color: var(--text-secondary);
  }

  .file-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  .file-attachment {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
  }

  .file-attachment .file-name {
    color: var(--text-primary);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-attachment .file-size {
    color: var(--text-dim);
    font-size: 11px;
  }

  .markdown-content {
    word-break: break-word;
  }

  .markdown-content :global(h1) {
    font-size: 20px;
    font-weight: 600;
    margin: 12px 0 8px;
    color: var(--text-primary);
  }

  .markdown-content :global(h2) {
    font-size: 18px;
    font-weight: 600;
    margin: 10px 0 6px;
    color: var(--text-primary);
  }

  .markdown-content :global(h3) {
    font-size: 16px;
    font-weight: 600;
    margin: 8px 0 4px;
    color: var(--text-primary);
  }

  .markdown-content :global(p) {
    margin: 0 0 8px;
  }

  .markdown-content :global(p:last-child) {
    margin-bottom: 0;
  }

  .markdown-content :global(strong) {
    color: var(--text-primary);
    font-weight: 600;
  }

  .markdown-content :global(em) {
    font-style: italic;
  }

  .markdown-content :global(a) {
    color: var(--amber-bright);
    text-decoration: none;
  }

  .markdown-content :global(a:hover) {
    text-decoration: underline;
  }

  .markdown-content :global(code) {
    background: var(--bg-code);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .markdown-content :global(ul) {
    margin: 8px 0;
    padding-left: 24px;
    list-style-type: disc;
  }

  .markdown-content :global(ol) {
    margin: 8px 0;
    padding-left: 24px;
    list-style-type: decimal;
  }

  .markdown-content :global(li) {
    margin: 4px 0;
  }

  .markdown-content :global(blockquote) {
    margin: 8px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--border-hover);
    background: var(--bg-raised);
    color: var(--text-secondary);
  }

  .markdown-content :global(table) {
    margin: 8px 0;
    border-collapse: collapse;
    width: 100%;
  }

  .markdown-content :global(th),
  .markdown-content :global(td) {
    padding: 6px 12px;
    border: 1px solid var(--border);
    text-align: left;
  }

  .markdown-content :global(th) {
    background: var(--bg-raised);
    font-weight: 600;
  }

  .markdown-content :global(hr) {
    margin: 12px 0;
    border: none;
    border-top: 1px solid var(--border);
  }

  .markdown-content :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
  }

  .streaming-cursor::after {
    content: '\258B';
    display: inline-block;
    animation: blink 1s infinite;
    color: var(--amber);
    margin-left: 2px;
  }

  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }

  @keyframes msgFadeUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .chat-msg-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .chat-msg:hover .chat-msg-actions {
    opacity: 1;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }

  .action-btn:active {
    transform: scale(0.95);
  }

  .rating-btn {
    padding: 4px 6px;
  }

  .rating-btn.active {
    background: var(--bg-accent-dim);
    color: var(--amber);
    border-color: var(--border-hover);
  }

  .delete-btn {
    margin-left: auto;
    color: var(--text-dim);
    border-color: transparent;
  }

  .delete-btn:hover {
    color: var(--red, #ef4444);
    border-color: var(--border-hover);
  }
</style>
