import { MAX_CUES, normalizeCue, type Cue } from '../playback/cues.ts';

export const TIMED_REQUEST = 'subtitle-translator:youtube-timed-request';
export const TIMED_RESPONSE = 'subtitle-translator:youtube-timed-response';
export const TIMED_MAX_BYTES = 1024 * 1024;
export const TIMED_MAX_TEXT = 200_000;
export type TrackIdentity = {
  videoId: string;
  language: string;
  sourceId: string;
  kind: string;
};
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Undocumented player data: accept only the selected original track for this video.
// URLs stay in the page world; there is no privileged URL-fetch message.
export function selectedTimedUrl(
  raw: unknown,
  track: TrackIdentity,
): URL | null {
  const response = record(raw);
  if (record(response?.videoDetails)?.videoId !== track.videoId) return null;
  const renderer = record(
    record(response?.captions)?.playerCaptionsTracklistRenderer,
  );
  if (
    !Array.isArray(renderer?.captionTracks) ||
    renderer.captionTracks.length > 100
  )
    return null;
  const matches = renderer.captionTracks
    .map(record)
    .filter(
      (item) =>
        item?.languageCode === track.language &&
        item?.vssId === track.sourceId &&
        (item?.kind === 'asr'
          ? 'asr'
          : item?.kind === undefined || item.kind === ''
            ? 'manual'
            : 'unknown') === track.kind,
    );
  if (
    matches.length !== 1 ||
    typeof matches[0]?.baseUrl !== 'string' ||
    matches[0].baseUrl.length > 8192
  )
    return null;
  try {
    const url = new URL(matches[0].baseUrl);
    if (
      url.origin !== 'https://www.youtube.com' ||
      url.pathname !== '/api/timedtext' ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.get('v') !== track.videoId ||
      url.searchParams.has('tlang') ||
      url.searchParams.getAll('v').length !== 1 ||
      url.searchParams.get('lang') !== track.language ||
      url.searchParams.getAll('lang').length !== 1 ||
      (url.searchParams.get('kind') === 'asr'
        ? 'asr'
        : url.searchParams.has('kind')
          ? 'unknown'
          : 'manual') !== track.kind
    )
      return null;
    url.searchParams.set('fmt', 'json3');
    return url;
  } catch {
    return null;
  }
}

// JSON3 text segments belong to one timed caption, not independent word updates.
// Append-only/live formats without complete intervals are deliberately unsupported.
export function parseTimedCaptions(raw: unknown): Cue[] | null {
  const data = record(raw);
  if (!Array.isArray(data?.events) || data.events.length > MAX_CUES * 2)
    return null;
  const cues: Cue[] = [];
  let characters = 0;
  for (const [index, value] of data.events.entries()) {
    const event = record(value);
    if (!event) return null;
    if (event.segs === undefined) continue; // window/style-only event
    if (!Array.isArray(event.segs) || event.segs.length > 512) return null;
    let text = '';
    for (const value of event.segs) {
      const segment = record(value);
      if (typeof segment?.utf8 !== 'string' || segment.utf8.length > 4096)
        return null;
      text += segment.utf8;
      if (text.length > 4096) return null;
    }
    if (!text.trim()) continue;
    if (event.aAppend !== undefined && event.aAppend !== 0) return null;
    if (
      typeof event.tStartMs !== 'number' ||
      typeof event.dDurationMs !== 'number' ||
      !Number.isSafeInteger(event.tStartMs) ||
      !Number.isSafeInteger(event.dDurationMs) ||
      event.dDurationMs > 120_000
    )
      return null;
    const cue = normalizeCue({
      startTime: event.tStartMs / 1000,
      endTime: (event.tStartMs + event.dDurationMs) / 1000,
      text,
    });
    if (!cue || cue.end > 7 * 24 * 60 * 60) return null;
    characters += text.length;
    if (characters > TIMED_MAX_TEXT || cues.length >= MAX_CUES) return null;
    cues.push({
      ...cue,
      id: `youtube-timed:${index}`,
      trackId: 'youtube-timed',
      revision: 1,
    });
  }
  return cues.length
    ? cues.sort((a, b) => a.start - b.start || a.end - b.end)
    : null;
}

export async function readTimedCaptions(
  response: Response,
  signal?: AbortSignal,
): Promise<Cue[] | null> {
  if (
    !response.ok ||
    response.redirected ||
    !response.body ||
    Number(response.headers.get('content-length')) > TIMED_MAX_BYTES
  ) {
    // Cancelling a tee branch can wait for the player to consume its branch.
    void response.body?.cancel().catch(() => {});
    return null;
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0,
    text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > TIMED_MAX_BYTES) return null;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return signal?.aborted ? null : parseTimedCaptions(JSON.parse(text));
  } catch {
    return null;
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
  }
}
