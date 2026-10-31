import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
export default defineContentScript({
  registration: 'runtime',
  noScriptStartedPostMessage: true,
  main(ctx) {
    let previous = '';
    let pending = false;
    let retry = false;
    const inspect = () => {
      const expired = document.querySelector(
        'translator-page-tools[data-edge-expired]',
      );
      if (
        !ctx.isValid ||
        pending ||
        (previous === location.href && !retry && !expired)
      )
        return;
      previous = location.href;
      retry = false;
      pending = true;
      void browser.runtime
        .sendMessage({
          version: 1,
          requestId: crypto.randomUUID(),
          type: 'page.auto',
        })
        .then((response: unknown) => {
          retry =
            !!response &&
            typeof response === 'object' &&
            'error' in response &&
            response.error === 'BUSY';
        })
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    };
    // Navigation, settings reset or session expiry can reconnect idle tools.
    // Unchanged pages send no heartbeat. The DOM expiry hint grants no authority.
    const timer = setInterval(inspect, 1800);
    inspect();
    const refresh: Parameters<
      typeof browser.runtime.onMessage.addListener
    >[0] = (message: unknown, sender) => {
      if (
        sender.id !== browser.runtime.id ||
        sender.tab ||
        !message ||
        typeof message !== 'object' ||
        !('type' in message)
      )
        return;
      if (message.type === 'page.reset') {
        previous = '';
        // The next local tick runs after the previous page context is disposed.
      }
    };
    browser.runtime.onMessage.addListener(refresh);
    ctx.onInvalidated(() => {
      clearInterval(timer);
      try {
        browser.runtime.onMessage.removeListener(refresh);
      } catch {
        /* Invalid context. */
      }
    });
  },
});
