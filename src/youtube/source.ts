import { z } from '../messaging/schema.ts';
import { MAX_CUES } from '../playback/cues.ts';
import { TIMED_MAX_TEXT } from './timed.ts';

export const TimedResponseSchema = z.strictObject({
  nonce: z.string().uuid(),
  key: z.string().max(512),
  cues: z
    .array(
      z
        .strictObject({
          id: z.string().regex(/^youtube-timed:\d{1,5}$/),
          trackId: z.literal('youtube-timed'),
          revision: z.literal(1),
          start: z.number().min(0).max(604800),
          end: z.number().positive().max(604800),
          text: z.string().min(1).max(4096),
        })
        .refine(
          (cue) =>
            cue.end > cue.start &&
            cue.end - cue.start <= 120 &&
            !!cue.text.trim(),
        ),
    )
    .min(1)
    .max(MAX_CUES)
    .refine(
      (cues) =>
        cues.reduce((sum, cue) => sum + cue.text.length, 0) <= TIMED_MAX_TEXT &&
        new Set(cues.map((c) => c.id)).size === cues.length,
    )
    .nullable(),
});

export const SOURCE_REQUEST = 'subtitle-translator:youtube-source-request';
export const SOURCE_RESPONSE = 'subtitle-translator:youtube-source-response';
export const SOURCE_STOP = 'subtitle-translator:youtube-source-stop';
export const YouTubeSourceSchema = z.strictObject({
  nonce: z.string().uuid(),
  videoId: z.string().regex(/^[\w-]{1,64}$/),
  language: z.string().max(35),
  sourceId: z.string().max(128),
  kind: z.enum(['manual', 'asr', 'unknown']),
  translated: z.boolean(),
  known: z.boolean(),
});
export type YouTubeSource = z.infer<typeof YouTubeSourceSchema>;

export { isYouTubeWatch } from './url.ts';

export function sourceKey(source: YouTubeSource) {
  return JSON.stringify([
    source.videoId,
    source.language,
    source.sourceId,
    source.kind,
    source.translated,
    source.known,
  ]);
}

export type ObservedCaption = Readonly<{
  id: string;
  revision: number;
  text: string;
  timing: 'observed';
}>;

// No invented start/end times: this text is known only while YouTube displays it.
export class ObservedRevision {
  #serial = 0;
  #current: ObservedCaption | null = null;
  clear() {
    this.#current = null;
    this.#serial++;
  }
  update(text: string): ObservedCaption | null {
    if (!text.trim() || text.length > 4096) {
      this.clear();
      return null;
    }
    if (this.#current?.text === text) return this.#current;
    this.#current = {
      id: `observed:${this.#serial}`,
      revision: (this.#current?.revision ?? 0) + 1,
      text,
      timing: 'observed',
    };
    return this.#current;
  }
}
