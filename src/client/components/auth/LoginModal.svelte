<script>
  /**
   * Login / Register modal.
   * Emits 'login' event with { token, user, sessionId, sessionToken } on success.
   */
  import { login as apiLogin, register as apiRegister } from '$apis/auth.api.js';
  import { setAuth } from '$stores/auth.store.js';
  import { t } from '$lib/i18n.js';
  import { warning } from '$stores/toast.store.js';
  import { onMount } from 'svelte';

  let _t = $derived($t);

  let { show = false } = $props();

  let isLogin = $state(true);
  let username = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let loading = $state(false);
  let error = $state('');

  // emit
  let { onclose, onlogin } = $props();

  function resetForm() {
    username = '';
    password = '';
    confirmPassword = '';
    error = '';
  }

  function switchMode() {
    isLogin = !isLogin;
    resetForm();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    error = '';

    if (!username.trim() || username.trim().length < 3) {
      error = _t('auth.usernameLength');
      return;
    }
    if (password.length < 6) {
      error = _t('auth.passwordLength');
      return;
    }
    if (!isLogin && password !== confirmPassword) {
      error = _t('auth.passwordMismatch');
      return;
    }

    loading = true;
    try {
      const result = isLogin
        ? await apiLogin(username.trim(), password)
        : await apiRegister(username.trim(), password);

      setAuth(result.token, result.user);
      onlogin?.({
        token: result.token,
        user: result.user,
        sessionId: result.sessionId,
        sessionToken: result.sessionToken
      });
    } catch (err) {
      error = err.message || (isLogin ? _t('auth.loginFailed') : _t('auth.registerFailed'));
    } finally {
      loading = false;
    }
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) {
      onclose?.();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      onclose?.();
    }
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleOverlayClick} onkeydown={handleKeydown} role="dialog" aria-modal="true" aria-label={isLogin ? _t('auth.login') : _t('auth.register')}>
    <div class="modal">
      <div class="modal-header">
        <h2>{isLogin ? _t('auth.login') : _t('auth.register')}</h2>
        <button class="close-btn" onclick={onclose} aria-label={_t('common.close')}>&times;</button>
      </div>

      <form onsubmit={handleSubmit}>
        <div class="form-group">
          <label for="auth-username">{_t('auth.username')}</label>
          <input
            id="auth-username"
            type="text"
            bind:value={username}
            placeholder={_t('auth.usernamePlaceholder')}
            autocomplete="username"
            required
            minlength={3}
          />
        </div>

        <div class="form-group">
          <label for="auth-password">{_t('auth.password')}</label>
          <input
            id="auth-password"
            type="password"
            bind:value={password}
            placeholder={_t('auth.passwordPlaceholder')}
            autocomplete={isLogin ? 'current-password' : 'new-password'}
            required
            minlength={6}
          />
        </div>

        {#if !isLogin}
          <div class="form-group">
            <label for="auth-confirm">{_t('auth.confirmPassword')}</label>
            <input
              id="auth-confirm"
              type="password"
              bind:value={confirmPassword}
              placeholder={_t('auth.confirmPlaceholder')}
              autocomplete="new-password"
              required
              minlength={6}
            />
          </div>
        {/if}

        {#if error}
          <div class="error-msg">{error}</div>
        {/if}

        <button type="submit" class="submit-btn" disabled={loading}>
          {loading ? _t('common.loading') : (isLogin ? _t('auth.login') : _t('auth.register'))}
        </button>
      </form>

      <div class="switch-mode">
        {#if isLogin}
          <span>{_t('auth.noAccount')}</span>
          <button class="link-btn" onclick={switchMode}>{_t('auth.register')}</button>
        {:else}
          <span>{_t('auth.hasAccount')}</span>
          <button class="link-btn" onclick={switchMode}>{_t('auth.login')}</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-raised, #1a1a2e);
    border: 1px solid var(--border, #333);
    border-radius: 12px;
    padding: 28px;
    width: 400px;
    max-width: 90vw;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }
  .modal-header h2 {
    margin: 0;
    font-size: 20px;
    color: var(--text-primary, #e0e0e0);
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim, #888);
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }
  .close-btn:hover { color: var(--text-primary, #e0e0e0); }
  .form-group {
    margin-bottom: 16px;
  }
  .form-group label {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
    color: var(--text-secondary, #aaa);
  }
  .form-group input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border, #333);
    border-radius: 8px;
    background: var(--bg-base, #111);
    color: var(--text-primary, #e0e0e0);
    font-size: 14px;
    box-sizing: border-box;
    outline: none;
    transition: border-color 0.2s;
  }
  .form-group input:focus {
    border-color: var(--accent, #6c5ce7);
  }
  .error-msg {
    color: var(--red, #e74c3c);
    font-size: 13px;
    margin-bottom: 12px;
    padding: 8px 12px;
    background: rgba(231, 76, 60, 0.1);
    border-radius: 6px;
  }
  .submit-btn {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 8px;
    background: var(--accent, #6c5ce7);
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .submit-btn:hover { opacity: 0.9; }
  .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .switch-mode {
    margin-top: 16px;
    text-align: center;
    font-size: 13px;
    color: var(--text-dim, #888);
  }
  .link-btn {
    background: none;
    border: none;
    color: var(--accent, #6c5ce7);
    cursor: pointer;
    padding: 0;
    margin-left: 4px;
    font-size: 13px;
  }
  .link-btn:hover { text-decoration: underline; }
</style>
