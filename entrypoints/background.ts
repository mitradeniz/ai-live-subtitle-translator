import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { createController } from '../src/background/controller.ts';
import { createPlaybackHandler } from '../src/background/activation.ts';

export default defineBackground(() => {
  const controller = createController(
    browser.runtime.id,
    {
      local: browser.storage.local,
      session: browser.storage.session,
    },
    (operation, confirmed) => playback.handle(operation, confirmed),
  );
  const playback: ReturnType<typeof createPlaybackHandler> =
    createPlaybackHandler(controller.sessions);
  browser.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      void controller.dispatch(message, sender).then(sendResponse);
      return true;
    },
  );
  browser.tabs.onRemoved.addListener((tabId) => playback.invalidate(tabId));
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url !== undefined)
      playback.invalidate(tabId);
  });
});
