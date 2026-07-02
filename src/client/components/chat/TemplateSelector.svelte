<script>
  import { t } from '$lib/i18n.js';
  import { templates, selectedTemplate, templateVariables, templatesByCategory, fetchTemplates, resetTemplate } from '../../stores/templates.store.js';

  let { onSelect = (prompt) => {} } = $props();
  let showPanel = $state(false);
  let currentLocale = $state('zh');
  let varValues = $state({});

  function handleSelect(tpl) {
    selectedTemplate.set(tpl);
    varValues = { ...(tpl.defaults || {}) };
  }

  $effect(() => {
    if ($selectedTemplate && Object.keys(varValues).length === 0) {
      varValues = { ...($selectedTemplate.defaults || {}) };
    }
  });

  async function handleRender() {
    const tpl = $selectedTemplate;
    if (!tpl) return;

    try {
      const res = await fetch('/api/templates/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: tpl.id,
          variables: varValues,
        }),
      });
      const data = await res.json();
      if (data.prompt) {
        onSelect(data.prompt);
        resetTemplate();
        showPanel = false;
        varValues = {};
      }
    } catch (e) {
      console.warn('[Template] render failed:', e.message);
    }
  }

  function getCategoryLabel(cat) {
    const labels = {
      code: $t('template_category_code') || 'Code',
      writing: $t('template_category_writing') || 'Writing',
      analysis: $t('template_category_analysis') || 'Analysis',
    };
    return labels[cat] || cat;
  }

  $effect(() => {
    if (showPanel) {
      fetchTemplates(currentLocale);
    }
  });
</script>

<div class="template-trigger">
  <button class="trigger-btn" onclick={() => { showPanel = !showPanel; }}>
    📋 {$t('template_button') || 'Templates'}
  </button>
</div>

{#if showPanel}
  <div class="template-panel">
    <div class="panel-header">
      <span>{$t('template_title') || 'Prompt Templates'}</span>
      <button class="close-btn" onclick={() => { showPanel = false; resetTemplate(); }}>✕</button>
    </div>

    {#if $selectedTemplate}
      <!-- 变量填充 -->
      <div class="template-fill">
        <div class="template-name">{$selectedTemplate.name}</div>
        <p class="template-desc">{$selectedTemplate.description}</p>

        {#each $selectedTemplate.variables as v}
            <div class="field">
              <label>{v}</label>
            {#if v === 'code' || v === 'text' || v === 'error'}
              <textarea
                class="input textarea"
                value={varValues[v] || ''}
                oninput={(e) => { varValues[v] = e.target.value; }}
                placeholder="{$t('template_enter_' + v) || 'Enter ' + v}"
                rows="3"
              ></textarea>
            {:else}
              <input
                class="input"
                value={varValues[v] || ''}
                oninput={(e) => { varValues[v] = e.target.value; }}
                placeholder="{$t('template_enter_' + v) || 'Enter ' + v}"
              />
            {/if}
          </div>
        {/each}

        <div class="actions">
          <button class="btn secondary" onclick={() => resetTemplate()}>
            {$t('common.back') || 'Back'}
          </button>
          <button class="btn primary" onclick={handleRender}>
            {$t('template_use') || 'Use'}
          </button>
        </div>
      </div>
    {:else}
      <!-- 模板列表 -->
      <div class="template-list">
        {#each Object.entries($templatesByCategory) as [category, items]}
          <div class="category-group">
            <div class="category-title">{getCategoryLabel(category)}</div>
            {#each items as tpl}
              <button class="template-item" onclick={() => handleSelect(tpl)}>
                <span class="item-name">{tpl.name}</span>
                <span class="item-desc">{tpl.description}</span>
              </button>
            {/each}
          </div>
        {/each}

        {#if $templates.length === 0}
          <div class="empty">{$t('common.noResults') || 'No templates'}</div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .template-trigger {
    display: inline-block;
  }
  .trigger-btn {
    background: none;
    border: 1px solid var(--border-color, #333);
    color: var(--text-secondary, #888);
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .trigger-btn:hover {
    border-color: var(--accent-color, #6c5ce7);
    color: var(--text-primary, #eee);
  }
  .template-panel {
    position: absolute;
    bottom: 100%;
    left: 0;
    width: 360px;
    max-height: 400px;
    background: var(--bg-secondary, #1a1a2e);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 100;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  }
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color, #333);
    font-weight: 600;
    font-size: 13px;
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted, #666);
    cursor: pointer;
    font-size: 14px;
  }
  .template-list {
    overflow-y: auto;
    flex: 1;
    padding: 8px;
  }
  .category-group {
    margin-bottom: 12px;
  }
  .category-title {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-muted, #666);
    padding: 4px 8px;
    letter-spacing: 0.5px;
  }
  .template-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-radius: 6px;
    padding: 8px 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .template-item:hover {
    background: var(--bg-hover, #2a2a3e);
  }
  .item-name {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary, #eee);
  }
  .item-desc {
    display: block;
    font-size: 11px;
    color: var(--text-muted, #666);
    margin-top: 2px;
  }
  .template-fill {
    padding: 12px;
    overflow-y: auto;
  }
  .template-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #eee);
  }
  .template-desc {
    font-size: 12px;
    color: var(--text-muted, #666);
    margin: 4px 0 12px;
  }
  .field {
    margin-bottom: 8px;
  }
  .field label {
    display: block;
    font-size: 11px;
    color: var(--text-secondary, #888);
    margin-bottom: 4px;
    text-transform: uppercase;
  }
  .input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-primary, #0a0a0c);
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    padding: 6px 10px;
    color: var(--text-primary, #eee);
    font-size: 12px;
  }
  .input.textarea {
    resize: vertical;
    min-height: 60px;
    font-family: inherit;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .btn {
    flex: 1;
    padding: 6px 12px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }
  .btn.primary {
    background: var(--accent-color, #6c5ce7);
    color: #fff;
  }
  .btn.secondary {
    background: var(--bg-primary, #0a0a0c);
    border: 1px solid var(--border-color, #333);
    color: var(--text-secondary, #888);
  }
  .empty {
    padding: 20px;
    text-align: center;
    color: var(--text-muted, #555);
    font-size: 13px;
  }
</style>
