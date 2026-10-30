import { CLOUD_HOST } from '../src/translation/google-cloud.ts';
import { AI_PROFILES } from '../src/translation/ai-profile.ts';
import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { createController } from '../src/background/controller.ts';
import { createPlaybackHandler } from '../src/background/activation.ts';
import { GOOGLE_HOST } from '../src/translation/contracts.ts';

export default defineBackground(() => {
  const controller = createController(
    browser.runtime.id,
    {
      local: browser.storage.local,
      session: browser.storage.session,
    },
    (operation, confirmed) => playback.handle(operation, confirmed),
    {
      permitted: () =>
        import.meta.env.MODE === 'mock'
          ? Promise.resolve(false)
          : browser.permissions.contains({ origins: [GOOGLE_HOST] }),
    },
    {
      permitted: (origin) =>
        import.meta.env.MODE === 'mock' ||
        !AI_PROFILES.some(
          (profile) => new URL(profile.endpoint).origin === origin,
        )
          ? Promise.resolve(false)
          : browser.permissions.contains({ origins: [`${origin}/*`] }),
    },
    {
      permitted: () =>
        import.meta.env.MODE === 'mock'
          ? Promise.resolve(false)
          : browser.permissions.contains({ origins: [CLOUD_HOST] }),
    },
  );
  const playback: ReturnType<typeof createPlaybackHandler> =
    createPlaybackHandler(controller.sessions);
  async function resetTranslations() {
    // Existing content contexts can outlive a worker's in-memory session registry.
    const tabs = await browser.tabs.query({});
    await Promise.allSettled(
      tabs
        .filter((tab) => tab.id !== undefined && !tab.incognito)
        .map((tab) =>
          browser.tabs.sendMessage(
            tab.id!,
            {
              version: 1,
              type: 'playback.translation-reset',
            },
            { frameId: 0 },
          ),
        ),
    );
  }
  browser.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      void controller.dispatch(message, sender).then(async (response) => {
        if (
          response.ok &&
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          [
            'google.enable',
            'google.disable',
            'ai.configure',
            'ai.enable',
            'ai.disable',
            'cloud.enable',
            'cloud.disable',
            'settings.update',
            'credentials.set',
            'credentials.delete',
            'cache.clear',
            'cache.configure',
            'data.clear',
          ].includes(String(message.type))
        )
          await resetTranslations();
        sendResponse(response);
      });
      return true;
    },
  );
  browser.permissions.onRemoved.addListener(() => {
    controller.cancelAll();
    void (async () => {
      if (!(await browser.permissions.contains({ origins: [GOOGLE_HOST] }))) {
        await controller.google.setEnabled(false);
        await controller.selection.disable('google');
      }
      if (!(await controller.ai.permitted()))
        await controller.selection.disable('ai');
      if (!(await controller.cloud.permitted()))
        await controller.selection.disable('google-cloud');
      controller.cancelAll();
      await resetTranslations();
    })().catch(() => {
      controller.cancelAll();
      void resetTranslations().catch(() => {});
    });
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void controller.sessions.ready
      .then(async () => {
        playback.invalidate(tabId);
        await controller.work.dropTab(tabId);
      })
      .catch(() => {});
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url !== undefined)
      void controller.sessions.ready
        .then(() => playback.invalidate(tabId))
        .catch(() => {});
  });
});
