import { SentenceIndex } from './sentences.ts';
import { TimedWindow } from './timed-window.ts';
import type { Settings } from '../messaging/protocol.ts';
import {
  activeCues,
  PlaybackGeneration,
  type CaptionTransform,
  type Cue,
} from './cues.ts';
import { NativeTrackAdapter } from './native-track.ts';
import { RenderedCaptions } from './rendered-captions.ts';
import { CaptionOverlay, type Appearance } from './overlay.ts';
import { TranslationFailure } from '../translation/contracts.ts';

export class CaptionPlayer {
  #video: HTMLVideoElement;
  #sentences = new SentenceIndex();
  #adapter: NativeTrackAdapter | undefined;
  #rendered: RenderedCaptions | undefined;
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
    onOpenSettings: () => void = () => {},
  ) {
    this.#video = video;
    this.#source = video.currentSrc;
    this.#settings = settings;
    this.#label = label;
    this.#rendered = RenderedCaptions.forVideo(video);
    if (transform)
      this.#window = new TimedWindow(
        transform,
        () => this.#paint(),
        (error) =>
          this.#overlay.setTranslationStatus(
            error instanceof TranslationFailure ? error.message : '',
          ),
        Boolean(this.#rendered),
      );
    this.#isValid = isValid;
    if (!this.#rendered) this.#adapter = new NativeTrackAdapter(video);
    this.#overlay = new CaptionOverlay(video, settings.fontSize, label, {
      settings,
      openSettings: onOpenSettings,
      change: onAppearance,
      disable: () => {
        onDisable();
        this.dispose();
      },
    });
    video.addEventListener('emptied', this.dispose);
    video.addEventListener('enterpictureinpicture', this.dispose);
    for (const name of ['seeking', 'ratechange'])
      video.addEventListener(name, this.#seek);
    for (const name of ['pause', 'play', 'seeked', 'timeupdate', 'ended'])
      video.addEventListener(name, this.#paint);
    window.addEventListener('pagehide', this.dispose);
    window.addEventListener('popstate', this.dispose);
    window.addEventListener('hashchange', this.dispose);
    document.addEventListener('fullscreenchange', this.#paint);
    // Player libraries may synchronously react to track.mode. A bounded poll
    // handles track/revision changes without an event-driven feedback loop.
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
      'Translation stopped. Enable captions again from the player menu or extension popup.',
    );
    this.#paint();
  }

  #seek = () => {
    if (this.#rendered) this.#cues = [];
    this.#invalidate(true);
  };

  #invalidate = (retainCompleted = false) => {
    this.#window?.reset(retainCompleted);
    this.#generation.next();
    this.#active = [];
    this.#result = null;
    if (this.#rendered) this.#overlay.nativeCaption(null);
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
    const cues = this.#rendered
      ? this.#video.seeking
        ? this.#cues
        : this.#rendered.snapshot()
      : this.#sentences.snapshot(this.#adapter?.snapshot() ?? []);
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
      : this.#rendered
        ? this.#cues
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
      this.#window?.update(this.#cues, this.#video.currentTime);
    this.#result = this.#window?.texts(cues) || null;

    const state = this.#rendered
      ? this.#cues.length
        ? 'Visible captions'
        : 'Turn on CC in the video player to translate visible captions.'
      : !this.#cues.length
        ? 'No accessible caption text'
        : !cues.length
          ? 'Waiting for next caption'
          : '';
    this.#overlay.setLabel([this.#label, state].filter(Boolean).join(' · '));
    const original = cues.map((cue) => cue.text).join('\n');
    const mock = this.#result?.join('\n');
    const mode = this.#settings.displayMode;
    if (this.#rendered) {
      this.#overlay.nativeCaption(
        mock && mode !== 'original' ? this.#rendered.layer : null,
      );
      if (!mock || mode === 'original') {
        this.#overlay.render('');
        return;
      }
    }
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
      mode === 'bilingual' && mock ? original : undefined,
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
      this.#video.removeEventListener(name, this.#seek);
    for (const name of ['pause', 'play', 'seeked', 'timeupdate', 'ended'])
      this.#video.removeEventListener(name, this.#paint);
    window.removeEventListener('pagehide', this.dispose);
    window.removeEventListener('popstate', this.dispose);
    window.removeEventListener('hashchange', this.dispose);
    document.removeEventListener('fullscreenchange', this.#paint);
    this.#adapter?.dispose();
    this.#overlay.dispose();
  };
}
