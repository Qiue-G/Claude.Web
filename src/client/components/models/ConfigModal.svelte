<script>
  import { createEventDispatcher } from 'svelte';
  import Modal from '$components/common/Modal.svelte';
  import ModelList from './ModelList.svelte';
  import { savedModels, addModel, removeModel, switchModel } from '$stores/models.store.js';
  import { fetchModels } from '$apis/models.api.js';
  import { t } from '$lib/i18n.js';

  export let open = false;

  const dispatch = createEventDispatcher();

  let activeTab = 'add';
  let formData = {
    name: '',
    provider: 'openrouter',
    model: '',
    apiKey: ''
  };
  let availableModels = [];
  let loadingModels = false;

  const providers = [
    { value: 'openrouter', label: 'OpenRouter' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'deepseek', label: 'DeepSeek' }
  ];

  $: if (open && activeTab === 'add') {
    loadAvailableModels();
  }

  async function loadAvailableModels() {
    loadingModels = true;
    try {
      const response = await fetchModels(formData.provider);
      availableModels = response.models || [];
    } catch (error) {
      console.error('Failed to load models:', error);
      availableModels = [];
    } finally {
      loadingModels = false;
    }
  }

  function handleProviderChange() {
    formData.model = '';
    loadAvailableModels();
  }

  function handleModelSelect(modelId) {
    formData.model = modelId;
  }

  async function handleAddModel() {
    if (!formData.name || !formData.model || !formData.apiKey) {
      return;
    }

    addModel({
      name: formData.name,
      provider: formData.provider,
      model: formData.model,
      apiKey: formData.apiKey
    });

    formData = { name: '', provider: 'openrouter', model: '', apiKey: '' };
    activeTab = 'manage';
  }

  function handleSwitchModel(e) {
    const model = e.detail;
    switchModel(model.id);
    dispatch('connect', model);
  }

  function handleDeleteModel(e) {
    const model = e.detail;
    if (confirm(`${$t('model.confirmDelete')} "${model.name}" ?`)) {
      removeModel(model.id);
    }
  }

  function handleEditModel(e) {
    const model = e.detail;
    formData = { ...model };
    activeTab = 'add';
  }

  function handleClose() {
    open = false;
    formData = { name: '', provider: 'openrouter', model: '', apiKey: '' };
    dispatch('close');
  }
</script>

<Modal {open} title={$t('model.configure')} on:close={handleClose}>
  <div class="config-modal">
    <div class="tabs">
      <button
        class="tab"
        class:active={activeTab === 'add'}
        on:click={() => activeTab = 'add'}
      >
        {$t('model.addModel')}
      </button>
      <button
        class="tab"
        class:active={activeTab === 'manage'}
        on:click={() => activeTab = 'manage'}
      >
        {$t('model.manage')}
      </button>
    </div>

    <div class="tab-content">
      {#if activeTab === 'add'}
        <form class="add-form" on:submit|preventDefault={handleAddModel}>
          <div class="form-group">
            <label for="name">{$t('model.name')}</label>
            <input
              type="text"
              id="name"
              bind:value={formData.name}
              placeholder="例如：Claude Sonnet 4"
              required
            />
          </div>

          <div class="form-group">
            <label for="provider">{$t('model.provider')}</label>
            <select id="provider" bind:value={formData.provider} on:change={handleProviderChange}>
              {#each providers as provider}
                <option value={provider.value}>{provider.label}</option>
              {/each}
            </select>
          </div>

          <div class="form-group">
            <label for="model">{$t('model.modelId')}</label>
            {#if loadingModels}
              <div class="loading">{$t('common.loading')}</div>
            {:else if availableModels.length > 0}
              <div class="model-select">
                <input
                  type="text"
                  id="model"
                  bind:value={formData.model}
                  placeholder="选择或输入模型 ID"
                  list="model-list"
                  required
                />
                <datalist id="model-list">
                  {#each availableModels as model}
                    <option value={model.id}>{model.name}</option>
                  {/each}
                </datalist>
              </div>
            {:else}
              <input
                type="text"
                id="model"
                bind:value={formData.model}
                placeholder="输入模型 ID"
                required
              />
            {/if}
          </div>

          <div class="form-group">
            <label for="apiKey">{$t('model.apiKey')}</label>
            <input
              type="password"
              id="apiKey"
              bind:value={formData.apiKey}
              placeholder="输入 API Key"
              required
            />
          </div>

          <button
            type="submit"
            class="submit-btn"
            disabled={!formData.name || !formData.model || !formData.apiKey}
          >
            {$t('model.addModel')}
          </button>
        </form>
      {:else}
        <ModelList
          on:switch={handleSwitchModel}
          on:delete={handleDeleteModel}
          on:edit={handleEditModel}
        />
      {/if}
    </div>
  </div>
</Modal>

<style>
  .config-modal {
    min-width: 420px;
  }

  @media (max-width: 480px) {
    .config-modal {
      min-width: unset;
      width: 100%;
    }
  }

  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 16px;
  }

  .tab {
    padding: 8px 16px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    font-family: var(--font-sans);
    transition: all 0.15s ease;
  }

  .tab:hover {
    color: var(--text-secondary);
  }

  .tab.active {
    color: var(--amber-bright);
    border-bottom-color: var(--amber);
  }

  .add-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-group label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .form-group input,
  .form-group select {
    padding: 8px 12px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 13px;
    font-family: var(--font-sans);
    transition: border-color 0.15s ease;
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: var(--border-hover);
  }

  .form-group input::placeholder {
    color: var(--text-dim);
  }

  .loading {
    padding: 8px 12px;
    color: var(--text-dim);
    font-size: 13px;
  }

  .submit-btn {
    padding: 10px 20px;
    background: var(--amber);
    border: none;
    border-radius: 6px;
    color: var(--bg-base);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
    font-family: var(--font-sans);
  }

  .submit-btn:hover:not(:disabled) {
    background: var(--amber-bright);
  }

  .submit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
