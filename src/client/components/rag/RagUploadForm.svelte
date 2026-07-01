<script>
  /**
   * RAG 上传表单
   * 支持：粘贴文本 / 选择文件（自动 base64） / URL / REST API
   */
  import { ingestText, ingestFile, ingestUrl, ingestRest } from '$apis/rag.api.js';
  import { sessionId, sessionToken, csrfToken } from '$stores/session.store.js';
  import { get } from 'svelte/store';

  export let toast = () => {};
  export let ingested = () => {};

  // 上传模式
  const MODES = ['text', 'file', 'url', 'rest'];
  let activeMode = 'text';

  // 公共
  let collection = '';
  let uploading = false;

  // 文本模式
  let textContent = '';

  // 文件模式
  let fileName = '';
  let fileContent = '';
  let fileSize = 0;
  let fileError = '';

  // URL 模式
  let url = '';

  // REST 模式
  let restUrl = '';
  let dataPath = '';

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    fileError = '';
    fileName = file.name;
    fileSize = file.size;

    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      fileError = `文件过大 (${(file.size / 1024 / 1024).toFixed(1)}MB)，最大 20MB`;
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      // 取 base64 部分（去掉 data:...;base64, 前缀）
      const result = reader.result;
      const commaIdx = result.indexOf(',');
      fileContent = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    const sid = get(sessionId);
    const tok = get(sessionToken);
    const csrf = get(csrfToken);

    if (!sid || !tok) {
      toast('请先连接模型', 'error');
      return;
    }
    if (!csrf) {
      toast('缺少 CSRF Token，请重新连接', 'error');
      return;
    }

    uploading = true;
    try {
      let result;
      const meta = {};

      switch (activeMode) {
        case 'text': {
          if (!textContent.trim()) throw new Error('请输入文本内容');
          result = await ingestText({ text: textContent, collection: collection || undefined, metadata: meta, sessionId: sid, token: tok, csrfToken: csrf });
          break;
        }
        case 'file': {
          if (!fileName || !fileContent) throw new Error('请选择一个文件');
          result = await ingestFile({ filename: fileName, content: fileContent, collection: collection || undefined, metadata: meta, sessionId: sid, token: tok, csrfToken: csrf });
          break;
        }
        case 'url': {
          if (!url.trim()) throw new Error('请输入 URL');
          result = await ingestUrl({ url: url.trim(), collection: collection || undefined, metadata: meta, sessionId: sid, token: tok, csrfToken: csrf });
          break;
        }
        case 'rest': {
          if (!restUrl.trim()) throw new Error('请输入 REST API URL');
          result = await ingestRest({ url: restUrl.trim(), dataPath: dataPath.trim() || undefined, collection: collection || undefined, metadata: meta, sessionId: sid, token: tok, csrfToken: csrf });
          break;
        }
      }

      toast(`摄入成功! 已添加 ${result.chunksIngested} 个块到集合 "${result.collection}"`, 'success');
      ingested(); // 通知列表刷新

      // 清空表单
      textContent = '';
      fileName = '';
      fileContent = '';
      url = '';
      restUrl = '';
    } catch (e) {
      toast(`上传失败: ${e.message}`, 'error');
    } finally {
      uploading = false;
    }
  }

  function isFormValid() {
    if (!get(sessionId)) return false;
    switch (activeMode) {
      case 'text': return textContent.trim().length > 0;
      case 'file': return fileName.length > 0 && fileContent.length > 0 && !fileError;
      case 'url': return url.trim().length > 0;
      case 'rest': return restUrl.trim().length > 0;
      default: return false;
    }
  }
</script>

<div class="upload-form">
  <h4>上传文档</h4>

  <!-- 模式切换 -->
  <div class="mode-tabs">
    {#each MODES as mode}
      <button
        class="mode-tab"
        class:active={activeMode === mode}
        onclick={() => activeMode = mode}
      >
        {#if mode === 'text'}文本
        {:else if mode === 'file'}文件
        {:else if mode === 'url'}URL
        {:else}REST API{/if}
      </button>
    {/each}
  </div>

  <!-- 集合选择 -->
  <div class="field">
    <label class="field-label">集合名称（可选，留空使用默认）</label>
    <input type="text" class="input" bind:value={collection} placeholder="留空自动使用 Session ID" />
  </div>

  <!-- 文本模式 -->
  {#if activeMode === 'text'}
    <div class="field">
      <label class="field-label">文本内容</label>
      <textarea class="textarea" bind:value={textContent} rows="6" placeholder="粘贴文本内容..."></textarea>
    </div>
  {/if}

  <!-- 文件模式 -->
  {#if activeMode === 'file'}
    <div class="field">
      <label class="field-label">选择文件（支持文档/PDF/CSV/代码/图片等）</label>
      <input type="file" class="file-input" onchange={handleFileSelect} />
      {#if fileName}
        <div class="file-info">
          <span>{fileName}</span>
          <span class="file-size">({(fileSize / 1024).toFixed(1)} KB)</span>
        </div>
      {/if}
      {#if fileError}
        <div class="field-error">{fileError}</div>
      {/if}
    </div>
  {/if}

  <!-- URL 模式 -->
  {#if activeMode === 'url'}
    <div class="field">
      <label class="field-label">网页 URL</label>
      <input type="url" class="input" bind:value={url} placeholder="https://example.com/article" />
    </div>
  {/if}

  <!-- REST 模式 -->
  {#if activeMode === 'rest'}
    <div class="field">
      <label class="field-label">REST API URL</label>
      <input type="url" class="input" bind:value={restUrl} placeholder="https://api.example.com/data" />
    </div>
    <div class="field">
      <label class="field-label">数据路径（可选，如 data.items）</label>
      <input type="text" class="input" bind:value={dataPath} placeholder="留空使用整个响应" />
    </div>
  {/if}

  <!-- 提交按钮 -->
  <button class="submit-btn" onclick={handleSubmit} disabled={uploading || !isFormValid()}>
    {uploading ? '上传中...' : '上传到知识库'}
  </button>
</div>

<style>
  .upload-form { padding: 0; }
  h4 { margin: 0 0 12px; font-size: 14px; color: var(--text-primary); }
  .mode-tabs { display: flex; gap: 4px; margin-bottom: 16px; }
  .mode-tab {
    flex: 1; padding: 6px 8px; text-align: center; font-size: 12px;
    background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text-dim); cursor: pointer; transition: all 0.15s;
  }
  .mode-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
  .mode-tab.active { background: var(--amber); color: white; border-color: var(--amber); }
  .field { margin-bottom: 12px; }
  .field-label { display: block; font-size: 12px; color: var(--text-dim); margin-bottom: 4px; }
  .input {
    width: 100%; padding: 8px 10px; font-size: 13px; font-family: inherit;
    background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text-primary); outline: none; box-sizing: border-box;
  }
  .input:focus { border-color: var(--accent); }
  .textarea {
    width: 100%; padding: 8px 10px; font-size: 13px; font-family: inherit;
    background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text-primary); outline: none; resize: vertical; box-sizing: border-box;
  }
  .textarea:focus { border-color: var(--accent); }
  .file-input { font-size: 13px; color: var(--text-primary); }
  .file-info { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
  .file-info span { display: inline; }
  .file-size { color: var(--text-muted); margin-left: 4px; }
  .field-error { font-size: 12px; color: var(--red); margin-top: 4px; }
  .submit-btn {
    width: 100%; padding: 10px; font-size: 14px; font-weight: 500;
    background: var(--amber); color: white; border: none; border-radius: 8px;
    cursor: pointer; transition: all 0.15s;
  }
  .submit-btn:hover { background: var(--amber-bright); }
  .submit-btn:disabled { opacity: 0.5; cursor: default; }
</style>