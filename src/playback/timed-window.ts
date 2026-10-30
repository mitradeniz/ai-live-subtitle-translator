import {
  activeCues,
  PlaybackGeneration,
  type CaptionTransform,
  type Cue,
} from './cues.ts';
import { TranslationFailure } from '../translation/contracts.ts';
export const LOOKAHEAD_SECONDS = 20;
export const WINDOW_CUES = 12;
export const BATCH_CHARACTERS = 2000;
export function cueWindow(cues: readonly Cue[], time: number, paused: boolean) {
  const active = activeCues(cues, time);
  const future = paused
    ? []
    : cues
        .filter((c) => c.start > time && c.start <= time + LOOKAHEAD_SECONDS)
        .sort((a, b) => a.start - b.start);
  return [...active, ...future].slice(0, WINDOW_CUES);
}
export class TimedWindow {
  #transform: CaptionTransform;
  #changed: () => void;
  #error: (error: unknown) => void;
  #generation = new PlaybackGeneration();
  #results = new Map<Cue, string>();
  #attempted = new Set<Cue>();
  #pending:
    { cues: Cue[]; abort: AbortController; current: boolean } | undefined;
  #window: Cue[] = [];
  #active: Cue[] = [];
  constructor(
    transform: CaptionTransform,
    changed: () => void,
    error: (error: unknown) => void,
  ) {
    this.#transform = transform;
    this.#changed = changed;
    this.#error = error;
  }
  reset() {
    this.#generation.next();
    this.#pending?.abort.abort();
    this.#pending = undefined;
    this.#results.clear();
    this.#attempted.clear();
    this.#window = [];
    this.#active = [];
  }
  update(cues: readonly Cue[], time: number, paused: boolean) {
    this.#window = cueWindow(cues, time, paused);
    this.#active = activeCues(cues, time);
    for (const cue of this.#results.keys())
      if (!this.#window.includes(cue)) this.#results.delete(cue);
    for (const cue of this.#attempted)
      if (!this.#window.includes(cue)) this.#attempted.delete(cue);
    const missingCurrent = this.#active.some(
      (c) => !this.#results.has(c) && !this.#attempted.has(c),
    );
    if (
      this.#pending &&
      ((missingCurrent && !this.#pending.current) ||
        this.#pending.cues.every((c) => !this.#window.includes(c)))
    ) {
      this.#pending.abort.abort();
      // Keep attempted markers: preempted paid work is uncertain and must not loop.
    }
    this.#pump();
  }
  texts(cues: readonly Cue[]) {
    return cues.length && cues.every((c) => this.#results.has(c))
      ? cues.map((c) => this.#results.get(c)!)
      : null;
  }
  #pump() {
    if (this.#pending) return;
    const candidates = this.#window.filter(
      (c) => !this.#results.has(c) && !this.#attempted.has(c),
    );
    const current = candidates.some((c) => this.#active.includes(c));
    const batch: Cue[] = [];
    let characters = 0;
    // Current captions are their own batch so a slow future cue cannot delay them.
    for (const cue of candidates.filter((c) =>
      current ? this.#active.includes(c) : true,
    )) {
      if (cue.text.length > 1000) {
        this.#attempted.add(cue);
        continue;
      }
      if (batch.length === 4 || characters + cue.text.length > BATCH_CHARACTERS)
        break;
      batch.push(cue);
      characters += cue.text.length;
    }
    if (!batch.length) return;
    batch.forEach((c) => this.#attempted.add(c));
    const pending = { cues: batch, abort: new AbortController(), current };
    this.#pending = pending;
    const generation = this.#generation.value;
    void this.#transform(batch, generation, pending.abort.signal, {
      priority: current ? 'current' : 'prefetch',
      observed: false,
    })
      .then((result) => {
        if (
          pending.abort.signal.aborted ||
          !this.#generation.accepts(result, batch)
        )
          return;
        for (let i = 0; i < batch.length; i++)
          if (this.#window.includes(batch[i]!))
            this.#results.set(batch[i]!, result.items[i]!.text);
        if (current) this.#error(null);
      })
      .catch((error) => {
        if (
          !pending.abort.signal.aborted &&
          current &&
          error instanceof TranslationFailure
        )
          this.#error(error);
      })
      .finally(() => {
        if (this.#pending !== pending) return;
        this.#pending = undefined;
        this.#changed();
        this.#pump();
      });
  }
}
