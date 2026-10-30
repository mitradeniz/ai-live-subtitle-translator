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
      'Early development build. Subtitle translation is not available yet.',
    minimum_chrome_version: '151',
    permissions: ['storage', 'activeTab', 'scripting'],
    incognito: 'not_allowed',
    action: {
      default_title: 'AI Live Subtitle Translator',
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'",
    },
  }),
});
