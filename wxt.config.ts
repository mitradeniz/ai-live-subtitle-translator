import { defineConfig } from 'wxt';
import packageJson from './package.json';
import { buildNotices } from './scripts/build-notices';
const notices = buildNotices();

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: { 'build:done': async (wxt) => notices.write(wxt.config.outDir) },
  imports: false,
  zip: {
    artifactTemplate: '{{name}}-{{versionName}}-{{browser}}.zip',
    zipSources: false,
  },
  vite: () => ({
    plugins: [notices.plugin],
    build: {
      target: 'chrome151',
      modulePreload: { polyfill: false },
    },
  }),
  manifest: ({ mode }) => ({
    version: packageJson.version,
    version_name: `${packageJson.version}-${mode === 'mock' ? 'mock' : 'preview.1'}`,
    name:
      mode === 'mock'
        ? '[TEST] Subtitle timing lab'
        : 'AI Video Subtitle Translator',
    description:
      mode === 'mock'
        ? 'Local caption timing test. Mock output is not translation.'
        : 'Limited preview. Page and video translation with optional Google, Google Cloud and user-key AI.',
    minimum_chrome_version: '151',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    permissions: ['storage', 'activeTab', 'scripting'],
    optional_host_permissions:
      mode === 'mock'
        ? []
        : [
            'https://translate.googleapis.com/*',
            'https://api.openai.com/*',
            'https://translation.googleapis.com/*',
            'https://api.deepseek.com/*',
            'https://generativelanguage.googleapis.com/*',
            'https://www.youtube.com/*',
            'https://*/*',
            'http://*/*',
          ],
    incognito: 'not_allowed',
    action: {
      default_title: 'AI Video Subtitle Translator',
      default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
    },
    content_security_policy: {
      extension_pages:
        mode === 'mock'
          ? "script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'"
          : "script-src 'self'; object-src 'none'; base-uri 'none'; connect-src https://translate.googleapis.com https://api.openai.com https://translation.googleapis.com https://api.deepseek.com https://generativelanguage.googleapis.com",
    },
  }),
});
