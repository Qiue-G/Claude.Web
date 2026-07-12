/**
 * Shiki syntax highlighting service.
 * Lazily initializes a highlighter and caches it for subsequent use.
 * Falls back to HTML-escaped plain text during initial load.
 * Uses dynamic import() to avoid bundling shiki into the main chunk.
 */

// Supported languages - only register what we actually use
const LANGUAGES = [
  'javascript', 'typescript', 'python', 'java', 'cpp', 'csharp',
  'go', 'rust', 'php', 'ruby', 'swift', 'kotlin',
  'sql', 'bash', 'shellscript', 'json', 'xml', 'css', 'markdown', 'yaml',
  'dockerfile', 'diff'
];

const THEMES = ['github-dark', 'github-light'];

let highlighter = null;
let initPromise = null;
let initError = null;

/**
 * Initialize the highlighter (lazy, called on first use).
 * Returns the same promise if called concurrently.
 */
async function ensureHighlighter() {
  if (highlighter) return highlighter;
  if (initError) throw initError;
  if (!initPromise) {
    initPromise = (async () => {
      const { createHighlighter } = await import('shiki');
      return createHighlighter({
        themes: THEMES,
        langs: LANGUAGES
      });
    })().then(h => {
      highlighter = h;
      return h;
    }).catch(err => {
      initError = err;
      console.error('[shiki] Failed to create highlighter:', err);
      throw err;
    });
  }
  return initPromise;
}

/**
 * Language alias map (same as used in CodeBlock)
 */
const LANG_ALIAS = {
  js: 'javascript', ts: 'typescript', py: 'python',
  c: 'cpp', cs: 'csharp', rb: 'ruby', kt: 'kotlin',
  sh: 'bash', shell: 'bash', html: 'xml', md: 'markdown',
  yml: 'yaml'
};

function resolveLang(language) {
  if (!language) return 'text';
  const alias = LANG_ALIAS[language];
  return alias || language;
}

let ready = false;
ensureHighlighter().then(() => { ready = true; });

/**
 * Check if the highlighter is ready for synchronous use.
 */
export function isReady() {
  return ready;
}

/**
 * Highlight code asynchronously.
 * Falls back to escaped HTML if the highlighter isn't ready yet.
 *
 * @param {string} code
 * @param {string} language
 * @param {string} [theme='github-dark']
 * @returns {Promise<string>} highlighted HTML
 */
export async function highlightCode(code, language, theme = 'github-dark') {
  try {
    const h = await ensureHighlighter();
    const lang = h.getLoadedLanguages().includes(resolveLang(language))
      ? resolveLang(language)
      : 'text';
    return h.codeToHtml(code, { lang, theme });
  } catch (e) {
    // fallback: plain HTML escape
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
}

/**
 * Batch highlight multiple code blocks in parallel.
 */
export async function highlightAll(blocks, theme = 'github-dark') {
  const h = await ensureHighlighter();
  return Promise.all(blocks.map(({ code, language }) => {
    const lang = h.getLoadedLanguages().includes(resolveLang(language))
      ? resolveLang(language)
      : 'text';
    return h.codeToHtml(code, { lang, theme });
  }));
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
