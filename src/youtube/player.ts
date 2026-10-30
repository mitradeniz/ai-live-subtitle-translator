import type { Settings } from '../messaging/protocol.ts';
import {
  activeCues,
  PlaybackGeneration,
  type CaptionTransform,
  type CaptionUnit,
  type Cue,
} from '../playback/cues.ts';
import { NativeTrackAdapter } from '../playback/native-track.ts';
import { CaptionOverlay } from '../playback/overlay.ts';
import {
  ObservedRevision,
  SOURCE_REQUEST,
  SOURCE_RESPONSE,
  SOURCE_STOP,
  YouTubeSourceSchema,
  sourceKey,
  type YouTubeSource,
} from './source.ts';

// Player/container/CC were observed live; segment is a synthetic-tested candidate.
// None of these selectors is a stable public API.
const SELECTORS = {
  player: '#movie_player',
  container: '.ytp-caption-window-container',
  segment: '.ytp-caption-segment',
  cc: '.ytp-subtitles-button',
};

export class YouTubePlayer {
  #video: HTMLVideoElement;
  #root: Element;
  #overlay: CaptionOverlay;
  #native: NativeTrackAdapter;
  #settings: Settings;
  #transform: CaptionTransform | undefined;
  #valid: () => boolean;
  #label: string;
  #source: YouTubeSource | null = null;
  #sourceAt = 0;
  #key = '';
  #nonce = '';
  #url = location.href;
  #observer: MutationObserver;
  #container: Element | null = null;
  #revision = new ObservedRevision();
  #generation = new PlaybackGeneration();
  #active: readonly CaptionUnit[] = [];
  #result: string | null = null;
  #waitMutation = false;
  #closed = false;
  #poll: ReturnType<typeof setInterval>;
  #frame = 0;
  #expires = Date.now() + 30 * 60_000;
  #started = Date.now();
  #timed: readonly Cue[] = [];
  #nativeInUse = false;

  constructor(
    video: HTMLVideoElement,
    settings: Settings,
    transform: CaptionTransform | undefined,
    valid: () => boolean,
    label: string,
  ) {
    this.#video = video;
    this.#root = video.closest(SELECTORS.player) ?? video.parentElement!;
    this.#settings = settings;
    this.#transform = transform;
    this.#valid = valid;
    this.#label = label;
    this.#native = new NativeTrackAdapter(video);
    this.#overlay = new CaptionOverlay(video, settings.fontSize, label);
    this.#observer = new MutationObserver(() => {
      if (!video.seeking) this.#waitMutation = false;
      this.#scan();
    });
    document.addEventListener(SOURCE_RESPONSE, this.#receive);
    document.addEventListener('yt-navigate-start', this.dispose);
    window.addEventListener('pagehide', this.dispose);
    window.addEventListener('popstate', this.dispose);
    video.addEventListener('seeking', this.#seek);
    video.addEventListener('emptied', this.dispose);
    video.addEventListener('enterpictureinpicture', this.dispose);
    this.#poll = setInterval(this.#scan, 200);
    this.#scan();
    this.#animate();
  }
  get active() {
    return !this.#closed;
  }
  #clear() {
    this.#generation.next();
    this.#revision.clear();
    this.#active = [];
    this.#result = null;
    this.#overlay.render('');
  }
  #seek = () => {
    this.#waitMutation = true;
    this.#clear();
  };
  #receive = (event: Event) => {
    const raw: unknown = (event as CustomEvent).detail;
    if (typeof raw !== 'string' || raw.length > 2048) return;
    try {
      const parsed = YouTubeSourceSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.nonce !== this.#nonce) return;
      if (parsed.data.videoId !== new URL(this.#url).searchParams.get('v')) {
        this.dispose();
        return;
      }
      const key = sourceKey(parsed.data);
      if (key !== this.#key) {
        if (this.#key) this.#waitMutation = true;
        this.#clear();
        this.#key = key;
      }
      this.#source = parsed.data;
      this.#sourceAt = Date.now();
    } catch {
      /* Page-controlled metadata cannot grant privileges. */
    }
  };
  #scan = () => {
    if (this.#closed) return;
    if (
      !this.#valid() ||
      !this.#video.isConnected ||
      !this.#root.isConnected ||
      location.href !== this.#url ||
      Date.now() >= this.#expires
    ) {
      this.dispose();
      return;
    }
    this.#nonce = crypto.randomUUID();
    document.dispatchEvent(
      new CustomEvent(SOURCE_REQUEST, { detail: this.#nonce }),
    );
    const container = this.#root.querySelector(SELECTORS.container);
    if (container !== this.#container) {
      this.#observer.disconnect();
      this.#container = container;
      this.#clear();
      this.#waitMutation = false;
      if (container)
        this.#observer.observe(container, {
          childList: true,
          subtree: true,
          characterData: true,
        });
    }
    const usable =
      this.#source?.known &&
      Date.now() - this.#sourceAt <= 1500 &&
      !this.#source.translated &&
      this.#root.querySelector(SELECTORS.cc)?.getAttribute('aria-pressed') ===
        'true';
    if (usable) {
      this.#nativeInUse = true;
      this.#timed = this.#native.snapshot();
    } else {
      if (this.#nativeInUse) {
        this.#native.dispose();
        this.#native = new NativeTrackAdapter(this.#video);
      }
      this.#nativeInUse = false;
      this.#timed = [];
    }
    this.#sample();
  };
  #sample = () => {
    if (this.#closed) return;
    const source = this.#source;
    let reason = '';
    if (!source || !source.known || Date.now() - this.#sourceAt > 1500)
      reason =
        'Caption source unavailable. Select a source track in YouTube, then re-enable.';
    else if (source.translated)
      reason = 'YouTube Auto-translate is selected. Choose an original track.';
    else if (
      this.#root.querySelector(SELECTORS.cc)?.getAttribute('aria-pressed') !==
      'true'
    )
      reason = 'Turn on YouTube CC to read visible captions.';
    else if (this.#root.classList.contains('ad-showing'))
      reason = 'Captions paused during the ad.';
    if (reason) {
      this.#clear();
      this.#overlay.setLabel(
        `${this.#label}${this.#label ? ' · ' : ''}${reason}`,
      );
      return;
    }
    const timed = this.#timed;
    const mode = timed.length
      ? 'Native timed track'
      : 'Visible captions · no cue timestamps';
    let units: readonly CaptionUnit[] = [];
    if (!this.#video.seeking) {
      if (timed.length) units = activeCues(timed, this.#video.currentTime);
      else if (!this.#waitMutation && this.#container) {
        const nodes = this.#container.querySelectorAll(SELECTORS.segment);
        if (nodes.length <= 16) {
          const text = Array.from(nodes)
            .map((node) => node.textContent ?? '')
            .join('\n');
          const caption = this.#revision.update(text);
          if (caption) units = [caption];
        }
      }
    }
    const description = `${mode} · ${source!.language} · ${source!.kind === 'asr' ? 'auto-generated' : 'manual'}`;
    this.#overlay.setLabel(
      `${this.#label}${this.#label ? ' · ' : ''}${description}${!units.length && Date.now() - this.#started > 8000 ? ' · No accessible caption text' : ''}`,
    );
    if (
      units.length !== this.#active.length ||
      units.some((unit, i) => unit !== this.#active[i])
    ) {
      this.#generation.next();
      this.#active = units;
      this.#result = null;
      if (units.length && this.#transform) {
        void this.#transform(
          units,
          this.#generation.value,
          this.#generation.signal,
        )
          .then((result) => {
            if (this.#closed || !this.#generation.accepts(result, this.#active))
              return;
            this.#result = result.items.map((item) => item.text).join('\n');
            this.#render();
          })
          .catch(() => {});
      }
    }
    this.#render();
  };
  #render() {
    const original = this.#active.map((unit) => unit.text).join('\n');
    const mode = this.#settings.displayMode;
    this.#overlay.render(
      !this.#result || mode === 'original'
        ? original
        : mode === 'translated'
          ? this.#result
          : `${original}\n${this.#result}`,
    );
  }
  #animate = () => {
    if (this.#closed) return;
    if (document.fullscreenElement === this.#video) {
      this.dispose();
      return;
    }
    this.#overlay.layout();
    if (this.#timed.length) this.#sample();
    this.#frame = requestAnimationFrame(this.#animate);
  };
  dispose = () => {
    if (this.#closed) return;
    this.#closed = true;
    this.#generation.next();
    clearInterval(this.#poll);
    cancelAnimationFrame(this.#frame);
    this.#observer.disconnect();
    this.#native.dispose();
    this.#overlay.dispose();
    document.removeEventListener(SOURCE_RESPONSE, this.#receive);
    document.removeEventListener('yt-navigate-start', this.dispose);
    window.removeEventListener('pagehide', this.dispose);
    window.removeEventListener('popstate', this.dispose);
    this.#video.removeEventListener('seeking', this.#seek);
    this.#video.removeEventListener('emptied', this.dispose);
    this.#video.removeEventListener('enterpictureinpicture', this.dispose);
    document.dispatchEvent(new CustomEvent(SOURCE_STOP));
  };
}
