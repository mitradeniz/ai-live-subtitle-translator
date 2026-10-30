import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { PlaybackControlSchema } from '../src/messaging/playback';
import { sendRequest } from '../src/messaging/client';
import { withinMessageBudget } from '../src/messaging/protocol';
import { CaptionPlayer } from '../src/playback/player';
import type { CaptionTransform } from '../src/playback/cues';

export default defineContentScript({
  registration: 'runtime',
  noScriptStartedPostMessage: true,
  // No matches: only explicit activeTab injection, never automatic site access.
  main(ctx) {
    let player: CaptionPlayer | undefined;
    let generation = 0;
    const onMessage: Parameters<
      typeof browser.runtime.onMessage.addListener
    >[0] = (raw: unknown, sender, respond) => {
      if (
        sender.id !== browser.runtime.id ||
        sender.tab ||
        !withinMessageBudget(raw)
      )
        return;
      const message = PlaybackControlSchema.safeParse(raw);
      if (!message.success) return;
      const control = message.data;
      if (control.type === 'playback.inspect') {
        respond(player?.active ? 'enabled' : 'disabled');
        return;
      }
      const ticket = ++generation;
      const startUrl = location.href;
      player?.dispose();
      player = undefined;
      if (control.type === 'playback.stop') {
        respond('disabled');
        return;
      }
      void (async () => {
        const data = await sendRequest({
          type: 'content.settings',
          sessionId: control.sessionId,
        });
        if (data.kind !== 'settings') throw new Error('Settings unavailable');
        let transform: CaptionTransform | undefined;
        if (import.meta.env.MODE === 'mock') {
          if (location.origin !== 'http://127.0.0.1:4173')
            throw new Error('Test fixture only');
          transform = (await import('../src/testing/mock-translator'))
            .mockTranslate;
        }
        if (
          ticket !== generation ||
          location.href !== startUrl ||
          ctx.isInvalid
        )
          return 'disabled';
        const video = Array.from(document.querySelectorAll('video'))
          .filter((video) => {
            const rect = video.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .sort(
            (a, b) =>
              b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
          )[0];
        if (!video) return 'no-video';
        player = new CaptionPlayer(
          video,
          data.settings,
          transform,
          () => ctx.isValid,
          import.meta.env.MODE === 'mock'
            ? 'MOCK · Timing test · Not a translation'
            : '',
        );
        return 'enabled';
      })().then(respond, () => respond('unavailable'));
      return true;
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => {
      generation++;
      player?.dispose();
      try {
        browser.runtime.onMessage.removeListener(onMessage);
      } catch {
        /* Context already removed by the browser. */
      }
    });
  },
});
