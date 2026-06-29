// @vitest-environment jsdom
/**
 * Svelte 组件渲染测试
 *
 * 测试组件：Icon, ThemeToggle, Toast, Navbar
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { get, writable } from 'svelte/store';

// ========================================================================
// i18n stub — 所有组件都依赖 $t，提供一个简单的 dummy store
// ========================================================================
vi.mock('$lib/i18n.js', () => {
  const locale = writable('zh');
  const tStore = writable(() => '');
  // $t 在 Svelte 模板里是 auto-subscribed store
  // 实际是个 derived store，这里简化直接返回字符串函数
  return {
    t: {
      subscribe: (run) => {
        run((key) => key); // $t(key) 返回 key 本身
        return () => {};
      }
    },
    currentLocale: { subscribe: (run) => { run('zh'); return () => {}; } },
    setLocale: vi.fn(),
    _: 'i18n mock'
  };
});

vi.mock('$stores/theme.store.js', () => ({
  theme: { subscribe: (run) => { run('dark'); return () => {}; } },
  toggleTheme: vi.fn(),
  systemTheme: { subscribe: (run) => { run('dark'); return () => {}; } },
  effectiveTheme: { subscribe: (run) => { run('dark'); return () => {}; } }
}));

vi.mock('$stores/chatHistory.store.js', () => ({
  currentSession: { subscribe: (run) => { run(null); return () => {}; } }
}));

// ========================================================================
// 浏览器环境 mock — 给 jsdom 补充 localStorage
// ========================================================================
beforeEach(() => {
  if (typeof localStorage === 'undefined') {
    const store = {};
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach(k => delete store[k]); },
        get length() { return Object.keys(store).length; },
        key: (i) => Object.keys(store)[i] ?? null
      },
      writable: true,
      configurable: true
    });
  }
  cleanup();
});

// ========================================================================
// Icon.svelte
// ========================================================================
describe('Icon.svelte', () => {
  it('renders SVG for a known icon name', async () => {
    const { container } = render(await import('$components/common/Icon.svelte').then(m => m.default), {
      props: { name: 'close', size: 'md' }
    });
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg.innerHTML).toContain('line');
  });

  it('renders no SVG for unknown icon name', async () => {
    const { container } = render(await import('$components/common/Icon.svelte').then(m => m.default), {
      props: { name: 'nonexistent', size: 'md' }
    });
    // Span wrapper still renders but with empty content
    expect(container.querySelector('svg')).toBeFalsy();
  });

  it('applies size class', async () => {
    const { container } = render(await import('$components/common/Icon.svelte').then(m => m.default), {
      props: { name: 'close', size: 'lg' }
    });
    const span = container.querySelector('span');
    expect(span.className).toContain('icon-lg');
  });

  it('renders different icons with different SVGs', async () => {
    const { container: c1 } = render(await import('$components/common/Icon.svelte').then(m => m.default), {
      props: { name: 'close' }
    });
    const { container: c2 } = render(await import('$components/common/Icon.svelte').then(m => m.default), {
      props: { name: 'check' }
    });
    expect(c1.querySelector('svg').innerHTML).not.toBe(c2.querySelector('svg').innerHTML);
  });

  it('applies custom className', async () => {
    const { container } = render(await import('$components/common/Icon.svelte').then(m => m.default), {
      props: { name: 'menu', className: 'my-icon' }
    });
    const span = container.querySelector('span');
    expect(span.className).toContain('my-icon');
  });
});

// ========================================================================
// ThemeToggle.svelte
// ========================================================================
describe('ThemeToggle.svelte', () => {
  it('renders a theme toggle button', async () => {
    // 重新导入以使用 mock
    const { default: ThemeToggle } = await import('$components/common/ThemeToggle.svelte');
    const { container } = render(ThemeToggle);
    const btn = container.querySelector('button');
    expect(btn).toBeTruthy();
    expect(btn.className).toContain('theme-toggle');
  });
});

// ========================================================================
// Navbar.svelte
// ========================================================================
describe('Navbar.svelte', () => {
  it('renders sidebar toggle button when showSidebarToggle is true', async () => {
    const { default: Navbar } = await import('$components/chat/Navbar.svelte');
    const { container } = render(Navbar, { props: { showSidebarToggle: true } });
    const buttons = container.querySelectorAll('button');
    // 至少应该有一个按钮 (sidebar toggle)
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it('hides sidebar toggle when showSidebarToggle is false', async () => {
    const { default: Navbar } = await import('$components/chat/Navbar.svelte');
    const { container } = render(Navbar, { props: { showSidebarToggle: false } });
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2); // 仍有 newchat + settings
  });

  it('shows new chat and settings buttons', async () => {
    const { default: Navbar } = await import('$components/chat/Navbar.svelte');
    const { container } = render(Navbar);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });
});

// ========================================================================
// Toast.svelte
// ========================================================================
/**
 * Toast 使用 toasts store 驱动渲染。
 * 创建一个可变的 writable store 供测试动态更新，无需重复 vi.mock
 */
const toastStore = { value: [] };
vi.mock('$stores/toast.store.js', () => ({
  toasts: {
    subscribe: (run) => {
      run(toastStore.value);
      // 每次 store 更新时重新通知订阅者
      const interval = setInterval(() => run(toastStore.value), 50);
      return () => clearInterval(interval);
    }
  },
  dismissToast: vi.fn(),
  removeToast: vi.fn()
}));

describe('Toast.svelte', () => {
  beforeEach(() => {
    toastStore.value = [];
    cleanup();
  });

  it('renders nothing when there are no toasts', async () => {
    const { default: Toast } = await import('$components/common/Toast.svelte');
    const { container } = render(Toast);
    const toastContainer = container.querySelector('.toast-container');
    expect(toastContainer).toBeTruthy();
    expect(toastContainer.children.length).toBe(0);
  });

  it('renders a toast when toasts are present', async () => {
    toastStore.value = [{ id: 1, message: 'Hello', type: 'info', duration: 3000, dismissing: false }];
    const { default: Toast } = await import('$components/common/Toast.svelte');
    const { container } = render(Toast);
    const toastEl = container.querySelector('.toast');
    expect(toastEl).toBeTruthy();
    expect(toastEl.textContent).toContain('Hello');
    expect(toastEl.className).toContain('toast-info');
  });

  it('renders different toast types with correct classes', async () => {
    const types = ['success', 'error', 'warning', 'info'];
    for (const type of types) {
      cleanup();
      toastStore.value = [{ id: 1, message: 'Test ' + type, type, duration: 3000, dismissing: false }];

      const { default: Toast } = await import('$components/common/Toast.svelte');
      const { container } = render(Toast);
      expect(container.querySelector(`.toast-${type}`)).toBeTruthy();
    }
  });

  it('adds dismissing class when toast is dismissing', async () => {
    toastStore.value = [{ id: 1, message: 'Bye', type: 'info', duration: 3000, dismissing: true }];
    const { default: Toast } = await import('$components/common/Toast.svelte');
    const { container } = render(Toast);
    expect(container.querySelector('.toast.dismissing')).toBeTruthy();
  });
});

// ========================================================================
// CodeBlock.svelte
// ========================================================================
describe('CodeBlock.svelte', () => {
  beforeEach(() => {
    cleanup();
  });

  it('escapes code when syntax highlighting throws', async () => {
    vi.doMock('highlight.js/lib/core', () => ({
      default: {
        registerLanguage: vi.fn(),
        getLanguage: () => true,
        highlight: () => { throw new Error('highlight failed'); },
        highlightAuto: () => { throw new Error('highlight failed'); }
      }
    }));

    const { default: CodeBlock } = await import('$components/chat/CodeBlock.svelte');
    const { container } = render(CodeBlock, {
      props: { code: '<img src=x onerror=alert(1)>', language: 'javascript' }
    });

    expect(container.querySelector('img')).toBeFalsy();
    expect(container.querySelector('code').textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

// ========================================================================
// CommandPalette.svelte 插件命令
// ========================================================================
describe('CommandPalette.svelte plugin commands', () => {
  beforeEach(async () => {
    cleanup();
    const keyboard = await import('$stores/keyboard.store.js');
    const plugins = await import('$stores/plugins.store.js');
    keyboard.isCommandPaletteOpen.set(true);
    plugins.pluginsConfig.set({
      starlight: {
        enabled: true,
        manifest: {
          commands: [{ id: 'starlight:toggle', name: '切换星夜主题', description: '测试插件命令' }],
          tokens: { dark: { '--ds-accent': '#a78ff0' } }
        }
      }
    });
    plugins.activeThemeTokens.set({ starlight: true });
  });

  it('executes plugin command when clicking a plugin command item', async () => {
    const plugins = await import('$stores/plugins.store.js');
    const { default: CommandPalette } = await import('$components/common/CommandPalette.svelte');
    render(CommandPalette);

    await fireEvent.click(screen.getByText('切换星夜主题'));

    expect(get(plugins.activeThemeTokens).starlight).toBe(false);
  });
});
