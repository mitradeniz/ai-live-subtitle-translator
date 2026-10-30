import { CueIndex, MAX_CUES, type Cue } from './cues.ts';

export class NativeTrackAdapter {
  #video: HTMLVideoElement;
  #original = new Map<TextTrack, TextTrackMode>();
  #track: TextTrack | undefined;
  #index = new CueIndex('native-0');
  #revision = 0;
  #last: readonly Cue[] = [];
  #closed = false;

  constructor(video: HTMLVideoElement) {
    this.#video = video;
  }

  snapshot(): readonly Cue[] {
    if (this.#closed) return [];
    const tracks = Array.from(this.#video.textTracks)
      .filter((track) => ['captions', 'subtitles'].includes(track.kind))
      .slice(0, 32);
    // Respect a newly selected native track. Otherwise retain the active one.
    const selected =
      tracks.find((track) => track.mode === 'showing') ??
      (this.#track && tracks.includes(this.#track) ? this.#track : tracks[0]);
    for (const track of this.#original.keys()) {
      if (!tracks.includes(track)) this.#restore(track);
    }
    if (selected !== this.#track) {
      this.#track = selected;
      this.#index = new CueIndex(`native-${++this.#revision}`);
      this.#last = [];
    }
    if (!selected) return [];
    if (!this.#original.has(selected))
      this.#original.set(selected, selected.mode);
    // Hidden loads native cues without painting a duplicate caption layer.
    for (const track of tracks) {
      if (track === selected || track.mode === 'showing') {
        if (!this.#original.has(track)) this.#original.set(track, track.mode);
        track.mode = 'hidden';
      }
    }
    const list = selected.cues;
    const next: Cue[] = [];
    if (list)
      for (let i = 0; i < Math.min(list.length, MAX_CUES); i++) {
        const cue = this.#index.read(list[i]);
        if (cue) next.push(cue);
      }
    next.sort((a, b) => a.start - b.start || a.end - b.end);
    if (
      next.length === this.#last.length &&
      next.every((cue, i) => cue === this.#last[i])
    )
      return this.#last;
    this.#last = next;
    return next;
  }

  #restore(track: TextTrack) {
    const original = this.#original.get(track);
    if (original !== undefined) track.mode = original;
    this.#original.delete(track);
  }

  dispose() {
    this.#closed = true;
    for (const track of this.#original.keys()) this.#restore(track);
    this.#last = [];
  }
}
