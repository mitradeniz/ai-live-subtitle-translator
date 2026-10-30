export type Cue = Readonly<{
  id: string;
  trackId: string;
  revision: number;
  start: number;
  end: number;
  text: string;
}>;

export const MAX_CUES = 5000;
export const MAX_OVERLAP = 4;

export function normalizeCue(
  raw: unknown,
): Pick<Cue, 'start' | 'end' | 'text'> | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!('startTime' in raw) || !('endTime' in raw) || !('text' in raw))
    return null;
  const { startTime: start, endTime: end, text } = raw;
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    typeof text !== 'string' ||
    text.length > 4096 ||
    !text.trim()
  )
    return null;
  return { start, end, text: text.replace(/\r\n?/g, '\n') };
}

// Object identity distinguishes duplicate native cue IDs; edits advance revision.
export class CueIndex {
  #entries = new WeakMap<object, Cue>();
  #next = 0;
  readonly trackId: string;
  constructor(trackId: string) {
    this.trackId = trackId;
  }

  read(raw: unknown): Cue | null {
    const normalized = normalizeCue(raw);
    if (!normalized || !raw || typeof raw !== 'object') return null;
    const previous = this.#entries.get(raw);
    if (
      previous &&
      previous.start === normalized.start &&
      previous.end === normalized.end &&
      previous.text === normalized.text
    )
      return previous;
    const cue: Cue = {
      ...normalized,
      trackId: this.trackId,
      id: previous?.id ?? `${this.trackId}:${++this.#next}`,
      revision: (previous?.revision ?? 0) + 1,
    };
    this.#entries.set(raw, cue);
    return cue;
  }
}

export function activeCues(cues: readonly Cue[], time: number): Cue[] {
  if (!Number.isFinite(time) || time < 0) return [];
  return cues
    .filter((cue) => cue.start <= time && time < cue.end)
    .slice(0, MAX_OVERLAP);
}

export type CaptionResult = {
  generation: number;
  items: { id: string; revision: number; text: string }[];
};
export type CaptionTransform = (
  cues: readonly Cue[],
  generation: number,
  signal: AbortSignal,
) => Promise<CaptionResult>;

export class PlaybackGeneration {
  #value = 0;
  #abort = new AbortController();
  get value() {
    return this.#value;
  }
  get signal() {
    return this.#abort.signal;
  }
  next() {
    this.#abort.abort();
    this.#abort = new AbortController();
    return ++this.#value;
  }
  accepts(result: CaptionResult, cues: readonly Cue[]) {
    return (
      result.generation === this.#value &&
      result.items.length === cues.length &&
      result.items.every(
        (item, i) =>
          item.id === cues[i]?.id &&
          item.revision === cues[i]?.revision &&
          typeof item.text === 'string' &&
          item.text.length <= 4200,
      )
    );
  }
}
