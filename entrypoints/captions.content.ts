import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { PlaybackControlSchema } from '../src/messaging/playback';
import { sendRequest } from '../src/messaging/client';
import { withinMessageBudget } from '../src/messaging/protocol';
import { CaptionPlayer } from '../src/playback/player';
import type { CaptionTransform } from '../src/playback/cues';
import { isYouTubeWatch, SOURCE_STOP } from '../src/youtube/source';
import { YouTubePlayer } from '../src/youtube/player';
import { providerTransform } from '../src/translation/client';

export default defineContentScript({
  registration: 'runtime',
  noScriptStartedPostMessage: true,
  // Runtime injection requires activeTab or an explicitly granted supported site.
  main(ctx) {
    let player: CaptionPlayer | YouTubePlayer | undefined;
    let generation = 0;
    let sessionId: string | undefined;
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
      if (control.type === 'playback.preferences') {
        const target = player;
        if (!target?.active || !sessionId) {
          respond('disabled');
          return;
        }
        void sendRequest({ type: 'content.settings', sessionId }).then(
          (data) => {
            if (target === player && data.kind === 'settings')
              target.applySettings(data.settings);
            respond('enabled');
          },
          () => {
            if (target === player) target.stopTranslation();
            respond('enabled');
          },
        );
        return true;
      }
      if (control.type === 'playback.site-stop') {
        if (isYouTubeWatch(location.href)) {
          player?.dispose();
          player = undefined;
          sessionId = undefined;
          generation++;
        }
        respond(player?.active ? 'enabled' : 'disabled');
        return;
      }
      if (control.type === 'playback.translation-reset') {
        player?.stopTranslation();
        respond('enabled');
        return;
      }
      if (control.type === 'playback.inspect') {
        respond(
          player?.active
            ? player.translationStopped
              ? 'needs-restart'
              : 'enabled'
            : 'disabled',
        );
        return;
      }
      const ticket = ++generation;
      const startUrl = location.href;
      player?.dispose();
      player = undefined;
      if (control.type === 'playback.stop') {
        sessionId = undefined;
        document.dispatchEvent(new CustomEvent(SOURCE_STOP));
        respond('disabled');
        return;
      }
      sessionId = control.sessionId;
      void (async () => {
        const data = await sendRequest({
          type: 'content.settings',
          sessionId: control.sessionId,
        });
        if (data.kind !== 'settings') throw new Error('Settings unavailable');
        let transform: CaptionTransform | undefined;
        if (import.meta.env.MODE === 'mock') {
          if (
            location.origin !== 'http://127.0.0.1:4173' &&
            !isYouTubeWatch(location.href)
          )
            throw new Error('Test fixture only');
          transform = (await import('../src/testing/mock-translator'))
            .mockTranslate;
        } else if (data.googleEnabled || data.aiEnabled || data.cloudEnabled) {
          transform = providerTransform(control.sessionId);
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
        if (!video) {
          document.dispatchEvent(new CustomEvent(SOURCE_STOP));
          return 'no-video';
        }
        const Player = isYouTubeWatch(location.href)
          ? YouTubePlayer
          : CaptionPlayer;
        if (Player === YouTubePlayer && !control.youtubeSourceConfirmed)
          return 'source-required';
        player = new Player(
          video,
          data.settings,
          transform,
          () => ctx.isValid,
          import.meta.env.MODE === 'mock'
            ? 'MOCK · Timing test · Not a translation'
            : transform
              ? (data.providerLabel ?? '')
              : '',
          (appearance) => {
            void sendRequest({
              type: 'content.appearance',
              sessionId: control.sessionId,
              appearance,
            }).catch(() => {
              player?.stopTranslation();
            });
          },
          () => {
            void sendRequest({
              type: 'content.stop',
              sessionId: control.sessionId,
            }).catch(() => {});
          },
        );
        return 'enabled';
      })().then(respond, () => {
        if (ticket === generation)
          document.dispatchEvent(new CustomEvent(SOURCE_STOP));
        respond('unavailable');
      });
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
