import type { Cue } from './cues.ts';

const EMPTY: readonly Cue[] = [];

// DeepLearning.AI's Vidstack layout renders the active cues separately from
// the native track. Leave track selection and loading in the site's hands.
export class LessonCaptions {
  #last: readonly Cue[] = EMPTY;
  #revision = 0;
  #player: Element;
  #layer: HTMLElement | null = null;

  static forVideo(video: HTMLVideoElement) {
    if (location.origin !== 'https://learn.deeplearning.ai') return undefined;
    const player = video.closest('.lesson-video-player[data-media-player]');
    return player ? new LessonCaptions(player) : undefined;
  }

  private constructor(player: Element) {
    this.#player = player;
  }

  get layer() {
    return this.#layer;
  }

  snapshot(): readonly Cue[] {
    const layer = this.#player.querySelector<HTMLElement>(
      '.vds-captions[data-part="captions"]',
    );
    this.#layer = layer;
    if (
      !layer ||
      layer.getAttribute('aria-hidden') === 'true' ||
      !layer.checkVisibility({ visibilityProperty: true })
    )
      return (this.#last = EMPTY);

    const nodes = layer.querySelectorAll('[data-part="cue"]');
    if (nodes.length > 4) return (this.#last = EMPTY);
    const lines = Array.from(nodes, (node) => node.textContent?.trim() ?? '')
      .filter(Boolean)
      .join('\n');
    if (!lines || lines.length > 1000) return (this.#last = EMPTY);
    if (lines === this.#last[0]?.text) return this.#last;

    // Observed cues carry an identity for translation, not media timestamps.
    const revision = ++this.#revision;
    return (this.#last = [
      {
        id: 'lesson-caption',
        trackId: 'lesson',
        revision,
        start: 0,
        end: 1,
        text: lines,
      },
    ]);
  }
}
