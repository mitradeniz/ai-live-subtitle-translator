import { TimedWindow } from './timed-window.ts';
import type { Settings } from '../messaging/protocol.ts';
import {
  activeCues,
  PlaybackGeneration,
  type CaptionTransform,
  type Cue,
} from './cues.ts';
import { NativeTrackAdapter } from './native-track.ts';
import { CaptionOverlay, type Appearance } from './overlay.ts';
import { TranslationFailure } from '../translation/contracts.ts';

export class CaptionPlayer {
  #video: HTMLVideoElement;
  #adapter: NativeTrackAdapter;
  #overlay: CaptionOverlay;
  #settings: Settings;
  #label: string;
  #window: TimedWindow | undefined;
  #isValid: () => boolean;
  #generation = new PlaybackGeneration();
  #cues: readonly Cue[] = [];
  #active: readonly Cue[] = [];
  #result: string[] | null = null;
  #frame = 0;
  #poll: ReturnType<typeof setInterval>;
  #closed = false;
  #observer: MutationObserver;
  #url = location.href;
  #source: string;
  #expiresAt = Date.now() + 30 * 60_000;

  constructor(
    video: HTMLVideoElement,
    settings: Settings,
    transform?: CaptionTransform,
    isValid: () => boolean = () => true,
    label = '',
    onAppearance: (appearance: Appearance) => void = () => {},
    onDisable: () => void = () => {},
  ) {
    this.#video = video;
    this.#source = video.currentSrc;
    this.#settings = settings;
    this.#label = label;
    if (transform)
      this.#window = new TimedWindow(
        transform,
        () => this.#paint(),
        (error) =>
          this.#overlay.setTranslationStatus(
            error instanceof TranslationFailure ? error.message : '',
          ),
      );
    this.#isValid = isValid;
    this.#adapter = new NativeTrackAdapter(video);
    this.#overlay = new CaptionOverlay(video, settings.fontSize, label, {
      settings,
      change: onAppearance,
      disable: () => {
        onDisable();
        this.dispose();
      },
    });
    video.addEventListener('emptied', this.dispose);
    video.addEventListener('enterpictureinpicture', this.dispose);
    for (const name of ['seeking', 'ratechange'])
      video.addEventListener(name, this.#invalidate);
    for (const name of ['pause', 'play', 'seeked', 'timeupdate', 'ended'])
      video.addEventListener(name, this.#paint);
    window.addEventListener('pagehide', this.dispose);
    window.addEventListener('popstate', this.dispose);
    window.addEventListener('hashchange', this.dispose);
    document.addEventListener('fullscreenchange', this.#paint);
    for (const name of ['addtrack', 'removetrack', 'change'])
      video.textTracks.addEventListener(name, this.#scan);
    this.#observer = new MutationObserver(this.#scan);
    this.#observer.observe(video, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    this.#poll = setInterval(this.#scan, 150);
    this.#scan();
    this.#animate();
  }

  get translationStopped() {
    return this.#translationStopped;
  }
  #translationStopped = false;
  get active() {
    return !this.#closed;
  }

  applySettings(settings: Settings) {
    const modeChanged = settings.displayMode !== this.#settings.displayMode;
    this.#settings = settings;
    this.#overlay.appearance(settings);
    if (modeChanged) this.#invalidate();
    this.#paint();
  }

  stopTranslation() {
    this.#translationStopped = true;
    this.#window?.reset();
    this.#window = undefined;
    this.#label = 'Original captions';
    this.#invalidate();
    this.#overlay.setTranslationStatus(
      'Translation stopped. Open the extension popup and choose Enable captions again.',
    );
    this.#paint();
  }

  #invalidate = () => {
    this.#window?.reset();
    this.#generation.next();
    this.#active = [];
    this.#result = null;
    this.#overlay.render('');
  };

  #scan = () => {
    if (
      !this.#isValid() ||
      !this.#video.isConnected ||
      location.href !== this.#url ||
      Date.now() >= this.#expiresAt ||
      (this.#source && this.#video.currentSrc !== this.#source)
    ) {
      this.dispose();
      return;
    }
    this.#source = this.#video.currentSrc;
    const cues = this.#adapter.snapshot();
    if (cues !== this.#cues) {
      this.#cues = cues;
      this.#invalidate();
    }
    this.#paint();
  };

  #paint = () => {
    if (this.#closed) return;
    if (
      document.fullscreenElement === this.#video ||
      document.pictureInPictureElement === this.#video
    ) {
      this.dispose();
      return;
    }
    this.#overlay.layout();
    const cues = this.#video.seeking
      ? []
      : activeCues(this.#cues, this.#video.currentTime);
    if (
      cues.length !== this.#active.length ||
      cues.some((cue, i) => cue !== this.#active[i])
    ) {
      this.#generation.next();
      this.#active = cues;
      this.#result = null;
    }
    if (!this.#video.seeking && this.#settings.displayMode !== 'original')
      this.#window?.update(
        this.#cues,
        this.#video.currentTime,
        this.#video.paused,
      );
    this.#result = this.#window?.texts(cues) || null;

    const state = !this.#cues.length
      ? 'No accessible caption text'
      : !cues.length
        ? 'Waiting for next caption'
        : '';
    this.#overlay.setLabel([this.#label, state].filter(Boolean).join(' · '));
    const original = cues.map((cue) => cue.text).join('\n');
    const mock = this.#result?.join('\n');
    const mode = this.#settings.displayMode;
    this.#overlay.render(
      mode === 'translated' &&
        !mock &&
        this.#window &&
        !this.#window.failed(cues)
        ? ''
        : !mock || mode === 'original'
          ? original
          : mode === 'translated'
            ? mock
            : `${original}\n${mock}`,
    );
  };

  #animate = () => {
    if (this.#closed) return;
    this.#paint();
    this.#frame = requestAnimationFrame(this.#animate);
  };

  dispose = () => {
    if (this.#closed) return;
    this.#closed = true;
    this.#window?.reset();
    this.#generation.next();
    cancelAnimationFrame(this.#frame);
    clearInterval(this.#poll);
    this.#video.removeEventListener('emptied', this.dispose);
    this.#video.removeEventListener('enterpictureinpicture', this.dispose);
    for (const name of ['seeking', 'ratechange'])
      this.#video.removeEventListener(name, this.#invalidate);
    for (const name of ['pause', 'play', 'seeked', 'timeupdate', 'ended'])
      this.#video.removeEventListener(name, this.#paint);
    window.removeEventListener('pagehide', this.dispose);
    window.removeEventListener('popstate', this.dispose);
    window.removeEventListener('hashchange', this.dispose);
    document.removeEventListener('fullscreenchange', this.#paint);
    this.#adapter.dispose();
    this.#observer.disconnect();
    for (const name of ['addtrack', 'removetrack', 'change'])
      this.#video.textTracks.removeEventListener(name, this.#scan);
    this.#overlay.dispose();
  };
}
