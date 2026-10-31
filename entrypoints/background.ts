import { createPageHandler } from '../src/background/page-activation.ts';
import { isYouTubeWatch } from '../src/youtube/source.ts';
import { YOUTUBE_HOST, YOUTUBE_ORIGIN } from '../src/background/sites.ts';
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
    {
      permitted: () =>
        import.meta.env.MODE === 'mock'
          ? Promise.resolve(false)
          : browser.permissions.contains({ origins: [YOUTUBE_HOST] }),
      changed: () => reconcileSites(true),
      activate: async (tabId, documentId) => {
        await playback.auto(tabId, documentId, () =>
          controller.sites.allowed(tabId),
        );
      },
    },
    async () => {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab?.id !== undefined && !tab.incognito
        ? { tabId: tab.id, youtube: isYouTubeWatch(tab.url ?? '') }
        : null;
    },
    () => browser.runtime.openOptionsPage(),
    (operation, run) => page.handle(operation, run),
    () => browser.action.openPopup(),
    (tabId, documentId, confirmed, authorized) =>
      playback.fromPage(tabId, documentId, confirmed, authorized),
  );
  const playback: ReturnType<typeof createPlaybackHandler> =
    createPlaybackHandler(controller.sessions, (id, paused) =>
      controller.sites.pause(id, paused),
    );
  const page = createPageHandler(controller.pageSessions);
  let reconciliation: Promise<void> = Promise.resolve();
  function reconcileSites(stop = false) {
    reconciliation = reconciliation
      .catch(() => {})
      .then(async () => {
        const enabled =
          import.meta.env.MODE !== 'mock' && (await controller.sites.enabled());
        const registered = await browser.scripting.getRegisteredContentScripts({
          ids: ['youtube-auto', 'youtube-caption-reader'],
        });
        if (!enabled) {
          if (registered.length)
            await browser.scripting.unregisterContentScripts({
              ids: registered.map((script) => script.id),
            });
          await controller.sites.configure(false, false);
          if (!stop && !registered.length) return;
          await controller.sessions.ready;
          controller.sessions.revokeOrigin(YOUTUBE_ORIGIN);
          for (const tab of await browser.tabs.query({}))
            if (tab.id !== undefined && !tab.incognito)
              await browser.tabs
                .sendMessage(
                  tab.id,
                  { version: 1, type: 'playback.site-stop' },
                  { frameId: 0 },
                )
                .catch(() => {});
          return;
        }
        const registrations = [
          {
            id: 'youtube-auto',
            matches: [YOUTUBE_HOST],
            js: ['/content-scripts/auto.js'],
            runAt: 'document_start' as const,
            persistAcrossSessions: true,
          },
          {
            id: 'youtube-caption-reader',
            matches: [YOUTUBE_HOST],
            js: ['/youtube-source.js'],
            runAt: 'document_start' as const,
            world: 'MAIN' as const,
            persistAcrossSessions: true,
          },
        ];
        for (const script of registrations) {
          if (registered.some((item) => item.id === script.id))
            await browser.scripting.updateContentScripts([script]);
          else await browser.scripting.registerContentScripts([script]);
        }
        // Existing documents retain their observer while the worker sleeps.
        // Only an explicit opt-in injects into already open tabs.
        if (!stop) return;
        const tabs = await browser.tabs.query({ url: [YOUTUBE_HOST] });
        for (const tab of tabs)
          if (tab.id !== undefined && !tab.incognito)
            await browser.scripting
              .executeScript({
                target: { tabId: tab.id, frameIds: [0] },
                files: ['/content-scripts/auto.js'],
              })
              .catch(() => {});
      });
    return reconciliation;
  }
  void reconcileSites().catch(() => {});
  async function resetTranslations(
    type:
      | 'playback.translation-reset'
      | 'playback.preferences' = 'playback.translation-reset',
  ) {
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
              type,
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
            'controls.update',
            'content.appearance',
            'controls.select',
          ].includes(String(message.type))
        )
          await resetTranslations(
            [
              'settings.update',
              'controls.update',
              'content.appearance',
            ].includes(String(message.type))
              ? 'playback.preferences'
              : 'playback.translation-reset',
          );
        if (
          response.ok &&
          message &&
          typeof message === 'object' &&
          'type' in message &&
          [
            'page.configure',
            'controls.select',
            'controls.update',
            'settings.update',
            'ai.configure',
            'google.enable',
            'google.disable',
            'ai.enable',
            'ai.disable',
            'cloud.enable',
            'cloud.disable',
            'credentials.set',
            'credentials.delete',
            'cache.clear',
            'data.clear',
          ].includes(String(message.type))
        ) {
          for (const tab of await browser.tabs.query({}))
            if (tab.id !== undefined && !tab.incognito)
              await browser.tabs
                .sendMessage(
                  tab.id,
                  { version: 1, type: 'page.reset' },
                  { frameId: 0 },
                )
                .catch(() => {});
        }
        sendResponse(response);
      });
      return true;
    },
  );
  browser.permissions.onRemoved.addListener((removed) => {
    controller.pageSessions.revokeAll();
    void browser.tabs
      .query({})
      .then((tabs) =>
        Promise.allSettled(
          tabs
            .filter((tab) => tab.id !== undefined)
            .map((tab) =>
              browser.tabs.sendMessage(
                tab.id!,
                { version: 1, type: 'page.reset' },
                { frameId: 0 },
              ),
            ),
        ),
      );
    if (removed.origins?.includes(YOUTUBE_HOST)) {
      void controller.sites
        .configure(false, false)
        .then(() => reconcileSites(true))
        .catch(() => {});
      if (removed.origins.length === 1) return;
    }
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
        await controller.sites.pause(tabId, false);
      })
      .catch(() => {});
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url !== undefined)
      void controller.sessions.ready
        .then(async () => {
          playback.invalidate(tabId);
          page.invalidate(tabId);
          if (change.status === 'loading')
            await controller.sites.pause(tabId, false);
        })
        .catch(() => {});
  });
});
