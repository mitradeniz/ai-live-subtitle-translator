import { AI_HOST } from '../src/translation/ai-profile.ts';
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
      permitted: () =>
        import.meta.env.MODE === 'mock'
          ? Promise.resolve(false)
          : browser.permissions.contains({ origins: [AI_HOST] }),
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
            'settings.update',
            'credentials.set',
            'credentials.delete',
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
      if (!(await browser.permissions.contains({ origins: [AI_HOST] })))
        await controller.selection.disable('ai');
      controller.cancelAll();
      await resetTranslations();
    })().catch(() => {
      controller.cancelAll();
      void resetTranslations().catch(() => {});
    });
  });
  browser.tabs.onRemoved.addListener((tabId) => playback.invalidate(tabId));
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url !== undefined)
      playback.invalidate(tabId);
  });
});
