import type { Cue } from './cues.ts';

export const endsSentence = (text: string) =>
  /[.!?…。！？][”’"')\]]*$/u.test(text.trim());
// Retain source timing envelopes. No inferred word-level timestamps.
export class SentenceIndex {
  #input: readonly Cue[] | undefined;
  #rolling = false;
  #output: readonly Cue[] = [];
  #previous = new Map<string, Cue>();
  snapshot(cues: readonly Cue[], rolling = false): readonly Cue[] {
    if (cues === this.#input && rolling === this.#rolling) return this.#output;
    this.#input = cues;
    this.#rolling = rolling;
    const result: Cue[] = [];
    let group: Cue | undefined;
    let count = 0;
    const flush = () => {
      if (!group) return;
      const prior = this.#previous.get(group.id);
      result.push(
        prior &&
          prior.text === group.text &&
          prior.start === group.start &&
          prior.end === group.end
          ? prior
          : { ...group, revision: (prior?.revision ?? 0) + 1 },
      );
      group = undefined;
      count = 0;
    };
    for (const cue of cues) {
      if (
        group &&
        (endsSentence(group.text) ||
          cue.trackId !== group.trackId ||
          (!rolling && cue.start < group.end) ||
          cue.start - group.end > 1 ||
          cue.end - group.start > 12 ||
          group.text.length + cue.text.length + 1 > 800 ||
          count >= 8)
      )
        flush();
      group = group
        ? {
            ...group,
            end: Math.max(group.end, cue.end),
            text: `${group.text.trimEnd()} ${cue.text.trimStart()}`,
          }
        : { ...cue };
      count++;
    }
    flush();
    if (rolling)
      for (let i = 0; i < result.length - 1; i++) {
        const cue = result[i]!,
          next = result[i + 1]!;
        if (next.start > cue.start && next.start < cue.end)
          result[i] = { ...cue, end: next.start };
      }
    this.#previous = new Map(result.map((cue) => [cue.id, cue]));
    this.#output = result;
    return result;
  }
}
