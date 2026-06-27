<script>
  import { createEventDispatcher, tick } from 'svelte';
  import Icon from '$components/common/Icon.svelte';
  import { isWaiting } from '$stores/chat.store.js';
  import { t } from '$lib/i18n.js';
  import { formatFileSize } from '$lib/utils.js';

  const dispatch = createEventDispatcher();
  /** @type {boolean} */
  export let paramsOpen = false;
  export let editContent = '';

  let inputText = '';
  let textarea;
  let fileInput;
  let attachedFiles = [];
  let isDragging = false;
  let dragCounter = 0;
  let pastedImages = [];

  // 自动调整 textarea 高度
  function autoResize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  // inputText 变化时自动调整高度（只跑一次 tick）
  let _prevInputText = '';
  $: if (inputText !== _prevInputText) {
    _prevInputText = inputText;
    tick().then(autoResize);
  }

  // 编辑回填：当 editContent 变化时填充到输入框
  $: if (editContent && editContent !== inputText) {
    inputText = editContent;
    tick().then(() => {
      autoResize();
      textarea?.focus();
      textarea?.setSelectionRange(inputText.length, inputText.length);
    });
  }

  function handleSend() {
    const text = inputText.trim();
    if ((!text && attachedFiles.length === 0 && pastedImages.length === 0) || $isWaiting) return;

    const wasEditing = !!editContent;

    dispatch('send', {
      text,
      files: attachedFiles,
      images: pastedImages
    });

    inputText = '';
    attachedFiles = [];
    pastedImages = [];
    if (wasEditing) dispatch('editSent');
    tick().then(() => {
      autoResize();
      textarea?.focus();
    });
  }

  function handleKeydown(e) {
    // Enter 发送消息（Shift+Enter 换行）
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    // Ctrl/Cmd + Enter 也可以发送
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
      return;
    }
    // Escape 仅清空输入文本，不清除附件
    if (e.key === 'Escape' && inputText) {
      e.preventDefault();
      inputText = '';
      return;
    }
  }

  function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    appendFiles(files);
    if (fileInput) fileInput.value = '';
  }

  function appendFiles(files) {
    // 分离图片和其他文件
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    const otherFiles = files.filter(f => !f.type.startsWith('image/'));

    if (imageFiles.length > 0) {
      // 读取图片为 base64
      Promise.all(imageFiles.map(readImageAsDataURL)).then(dataURLs => {
        pastedImages = [...pastedImages, ...dataURLs.map((dataURL, i) => ({
          dataURL,
          name: imageFiles[i].name,
          size: imageFiles[i].size,
          type: imageFiles[i].type
        }))];
      });
    }

    if (otherFiles.length > 0) {
      attachedFiles = [...attachedFiles, ...otherFiles];
    }
  }

  function readImageAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function removeFile(index) {
    attachedFiles = attachedFiles.filter((_, i) => i !== index);
  }

  function removeImage(index) {
    pastedImages = pastedImages.filter((_, i) => i !== index);
  }

  // 拖拽事件处理
  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (e.dataTransfer?.types?.includes('Files')) {
      isDragging = true;
    }
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
      isDragging = false;
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;
    dragCounter = 0;
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      appendFiles(files);
    }
  }

  // 粘贴事件处理（用于图片粘贴）
  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageItems.push(file);
      }
    }

    if (imageItems.length > 0) {
      e.preventDefault();
      appendFiles(imageItems);
    }
  }
</script>

<div
  class="chat-input-bar"
  class:dragging={isDragging}
  on:dragenter={handleDragEnter}
  on:dragleave={handleDragLeave}
  on:dragover={handleDragOver}
  on:drop={handleDrop}
  role="region"
  aria-label="message input"
>
  {#if isDragging}
    <div class="drop-overlay" aria-hidden="true">
      <div class="drop-message">
        <Icon name="upload" size="lg" />
        <span>松开以上传文件</span>
      </div>
    </div>
  {/if}

  {#if pastedImages.length > 0 || attachedFiles.length > 0}
    <div class="attachments">
      {#each pastedImages as image, index (index)}
        <div class="image-preview">
          <img src={image.dataURL} alt={image.name} />
          <button
            type="button"
            class="remove-btn"
            on:click={() => removeImage(index)}
            aria-label="remove image"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      {/each}

      {#each attachedFiles as file, index (index + '-file')}
        <div class="file-item">
          <Icon name="paperclip" size="sm" />
          <span class="file-name">{file.name}</span>
          <span class="file-size">{formatFileSize(file.size)}</span>
          <button
            type="button"
            class="remove-btn"
            on:click={() => removeFile(index)}
            aria-label="remove file"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="input-wrapper">
    <button
      type="button"
      class="attach-btn"
      on:click={() => fileInput.click()}
      disabled={$isWaiting}
      title={$t('chat.attachFile')}
      aria-label={$t('chat.attachFile')}
    >
      <Icon name="paperclip" size="md" />
    </button>

    <button
      type="button"
      class="params-btn"
      class:active={paramsOpen}
      on:click={() => dispatch('toggleParams')}
      disabled={$isWaiting}
      title={$t('model.parameters')}
      aria-label={$t('model.parameters')}
    >
      <Icon name="settings" size="md" />
    </button>

    <input
      type="file"
      id="chat-file-input"
      name="chat-file-input"
      bind:this={fileInput}
      on:change={handleFileSelect}
      multiple
      style="display: none;"
    />

    <textarea
      bind:this={textarea}
      bind:value={inputText}
      on:keydown={handleKeydown}
      on:paste={handlePaste}
      on:input={autoResize}
      placeholder={$t('chat.placeholder')}
      rows="1"
      disabled={$isWaiting}
      aria-label="message input"
    ></textarea>

    <button
      type="button"
      class="send-btn"
      class:loading={$isWaiting}
      on:click={handleSend}
      disabled={$isWaiting || (!inputText.trim() && attachedFiles.length === 0 && pastedImages.length === 0)}
      aria-label={$isWaiting ? '发送中...' : $t('chat.send')}
      title={$isWaiting ? '发送中...' : $t('chat.send')}
    >
      {#if $isWaiting}
        <span class="send-spinner"></span>
      {:else}
        <Icon name="send" size="md" />
      {/if}
    </button>
  </div>
</div>

<style>
  .chat-input-bar {
    position: relative;
    padding: 12px 24px;
    border-top: 1px solid var(--border);
    background: var(--bg-toolbar);
    flex-shrink: 0;
    transition: background 0.15s;
  }

  .chat-input-bar.dragging {
    background: var(--bg-hover);
  }

  .drop-overlay {
    position: absolute;
    inset: 4px;
    border: 2px dashed var(--amber, #f59e0b);
    border-radius: 8px;
    background: rgba(245, 158, 11, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 5;
  }

  .drop-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--amber, #f59e0b);
    font-size: 14px;
    font-weight: 500;
  }

  .attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
    padding: 8px;
    background: var(--bg-input);
    border-radius: 6px;
  }

  .image-preview {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .image-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .image-preview .remove-btn {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    border: none;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--bg-secondary);
    border-radius: 4px;
    font-size: 12px;
  }

  .file-name {
    color: var(--text-primary);
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-size {
    color: var(--text-dim);
    font-size: 11px;
  }

  .remove-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    border-radius: 3px;
    transition: all 0.15s;
  }

  .remove-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .input-wrapper {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px;
    transition: border-color 0.2s;
  }

  .input-wrapper:focus-within {
    border-color: var(--border-hover);
  }

  .attach-btn,
  .params-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .attach-btn:hover:not(:disabled),
  .params-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .params-btn.active {
    background: var(--amber, #f59e0b);
    color: #fff;
  }

  .attach-btn:disabled,
  .params-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  textarea {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.5;
    resize: none;
    min-height: 24px;
    max-height: 200px;
    overflow-y: auto;
  }

  textarea::placeholder {
    color: var(--text-dim);
  }

  textarea:disabled {
    opacity: 0.5;
  }

  .send-btn {
    background: var(--amber);
    border: none;
    color: var(--bg-base);
    width: 32px;
    height: 32px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, opacity 0.15s;
  }

  .send-btn:hover:not(:disabled) {
    background: var(--amber-bright);
  }

  .send-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .send-btn.loading {
    opacity: 0.7;
    pointer-events: none;
  }

  .send-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: sendSpin 0.6s linear infinite;
  }

  @keyframes sendSpin {
    to { transform: rotate(360deg); }
  }
</style>
