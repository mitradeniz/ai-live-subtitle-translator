import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  imports: false,
  vite: () => ({
    build: {
      target: 'chrome151',
      modulePreload: { polyfill: false },
    },
  }),
  manifest: ({ mode }) => ({
    name:
      mode === 'mock'
        ? '[TEST] Subtitle timing lab'
        : 'AI Live Subtitle Translator',
    description:
      mode === 'mock'
        ? 'Local caption timing test. Mock output is not translation.'
        : 'Early development. Optional Google or user-key OpenAI caption translation.',
    minimum_chrome_version: '151',
    permissions: ['storage', 'activeTab', 'scripting'],
    optional_host_permissions:
      mode === 'mock'
        ? []
        : ['https://translate.googleapis.com/*', 'https://api.openai.com/*'],
    incognito: 'not_allowed',
    action: {
      default_title: 'AI Live Subtitle Translator',
    },
    content_security_policy: {
      extension_pages:
        mode === 'mock'
          ? "script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'"
          : "script-src 'self'; object-src 'none'; base-uri 'none'; connect-src https://translate.googleapis.com https://api.openai.com",
    },
  }),
});
