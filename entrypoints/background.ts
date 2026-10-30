import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { createController } from '../src/background/controller.ts';

export default defineBackground(() => {
  const controller = createController(browser.runtime.id, {
    local: browser.storage.local,
    session: browser.storage.session,
  });
  browser.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      void controller.dispatch(message, sender).then(sendResponse);
      return true;
    },
  );
  browser.tabs.onRemoved.addListener((tabId) =>
    controller.sessions.revokeTab(tabId),
  );
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading') controller.sessions.revokeTab(tabId);
  });
});
