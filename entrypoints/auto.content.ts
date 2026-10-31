import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { isYouTubeWatch } from '../src/youtube/url';
export default defineContentScript({
  registration: 'runtime',
  noScriptStartedPostMessage: true,
  main(ctx) {
    let lastVideo: HTMLVideoElement | null = null;
    let lastUrl = '';
    let lastSent = 0;
    let pending = false;
    const stopReader = () =>
      document.dispatchEvent(
        new CustomEvent('subtitle-translator:youtube-source-stop', {
          detail: 'purge',
        }),
      );
    const onMessage: Parameters<
      typeof browser.runtime.onMessage.addListener
    >[0] = (message: unknown, sender) => {
      if (
        sender.id === browser.runtime.id &&
        !sender.tab &&
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'playback.site-stop'
      )
        stopReader();
    };
    browser.runtime.onMessage.addListener(onMessage);
    const inspect = () => {
      if (!ctx.isValid || pending || !isYouTubeWatch(location.href)) return;
      const video = document.querySelector('video');
      if (
        !video ||
        !video.clientWidth ||
        !video.clientHeight ||
        (video === lastVideo && location.href === lastUrl) ||
        Date.now() - lastSent < 2500
      )
        return;
      lastVideo = video;
      lastUrl = location.href;
      lastSent = Date.now();
      pending = true;
      void browser.runtime
        .sendMessage({
          version: 1,
          requestId: crypto.randomUUID(),
          type: 'site.activate',
        })
        .then((response: unknown) => {
          // A quick refresh can reach the per-tab gate before it expires.
          // Retry only that explicit local limit; unchanged successful pages stay quiet.
          if (
            response &&
            typeof response === 'object' &&
            'ok' in response &&
            response.ok === false &&
            'error' in response &&
            response.error === 'BUSY'
          ) {
            lastVideo = null;
            lastUrl = '';
          }
        })
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    };
    // This only observes the document. Unchanged pages send no worker heartbeat.
    const timer = setInterval(inspect, 1000);
    const observer = new MutationObserver(inspect);
    observer.observe(document, {
      childList: true,
      subtree: true,
    });
    inspect();
    ctx.onInvalidated(() => {
      stopReader();
      try {
        browser.runtime.onMessage.removeListener(onMessage);
      } catch {
        /* Invalidated context. */
      }
      clearInterval(timer);
      observer.disconnect();
    });
  },
});
