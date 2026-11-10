import type { Cue } from './cues.ts';

const EMPTY: readonly Cue[] = [];

// Scope each renderer to its own video player, away from transcripts and controls.
const layouts = [
  {
    player: '[data-media-player]',
    layer: '[data-part="captions"].vds-captions',
    cue: '[data-part="cue"]',
  },
  {
    player: '.video-js',
    layer: '.vjs-text-track-display:not(.vjs-hidden)',
    cue: '.vjs-text-track-cue',
  },
  {
    player: '.shaka-video-container, [data-shaka-player-container]',
    layer: '.shaka-text-container',
    cue: ':scope > *',
  },
  { player: '.plyr--html5', layer: '.plyr__captions', cue: '.plyr__caption' },
] as const;
type Layout = (typeof layouts)[number];

export class RenderedCaptions {
  #last: readonly Cue[] = EMPTY;
  #revision = 0;
  #player: Element;
  #layout: Layout;
  #layer: HTMLElement | null = null;
  #off = true;

  static forVideo(video: HTMLVideoElement) {
    for (const layout of layouts) {
      const player = video.closest(layout.player);
      const layer = player?.querySelector(layout.layer);
      if (player && layer?.closest(layout.player) === player)
        return new RenderedCaptions(player, layout);
    }
  }

  private constructor(player: Element, layout: Layout) {
    this.#player = player;
    this.#layout = layout;
  }

  get layer() {
    return this.#layer;
  }
  // True while the player's own captions are switched off or hidden.
  get off() {
    return this.#off;
  }

  snapshot(): readonly Cue[] {
    const layer = this.#player.querySelector<HTMLElement>(this.#layout.layer);
    this.#layer = layer;
    if (
      !layer ||
      layer.closest(this.#layout.player) !== this.#player ||
      layer.getAttribute('aria-hidden') === 'true' ||
      !layer.checkVisibility({ visibilityProperty: true })
    ) {
      this.#off = true;
      return (this.#last = EMPTY);
    }
    this.#off = false;

    const nodes = layer.querySelectorAll<HTMLElement>(this.#layout.cue);
    if (nodes.length > 4) return (this.#last = EMPTY);
    const lines = Array.from(nodes, (node) =>
      node.checkVisibility({ visibilityProperty: true })
        ? node.innerText.trim()
        : '',
    )
      .filter(Boolean)
      .join('\n');
    if (!lines || lines.length > 1000) return (this.#last = EMPTY);
    if (lines === this.#last[0]?.text) return this.#last;

    // Observed cues carry an identity for translation, not media timestamps.
    const revision = ++this.#revision;
    return (this.#last = [
      {
        id: 'rendered-caption',
        trackId: 'rendered',
        revision,
        start: 0,
        end: 1,
        text: lines,
      },
    ]);
  }
}
