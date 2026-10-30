import { z } from '../messaging/schema.ts';

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

export function isYouTubeWatch(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === 'https://www.youtube.com' &&
      parsed.pathname === '/watch' &&
      /^[\w-]{1,64}$/.test(parsed.searchParams.get('v') ?? '')
    );
  } catch {
    return false;
  }
}

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
