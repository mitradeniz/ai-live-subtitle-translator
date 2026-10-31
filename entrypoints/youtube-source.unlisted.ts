import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import {
  TIMED_REQUEST,
  TIMED_RESPONSE,
  TIMED_MAX_BYTES,
  selectedTimedUrl,
  readTimedCaptions,
  type TrackIdentity,
} from '../src/youtube/timed.ts';

// Untrusted page-world reader. Never receives provider keys or extension APIs.
export default defineUnlistedScript(() => {
  if (
    location.origin !== 'https://www.youtube.com' ||
    location.pathname !== '/watch'
  )
    return;
  const request = 'subtitle-translator:youtube-source-request';
  const response = 'subtitle-translator:youtube-source-response';
  const stop = 'subtitle-translator:youtube-source-stop';
  const scope = globalThis as typeof globalThis & {
    __subtitleSourceCleanup?: () => void;
  };
  scope.__subtitleSourceCleanup?.();
  let selected: (TrackIdentity & { key: string }) | null = null;
  let pending: AbortController | undefined;
  let closed = false;
  const attempted = new Set<string>();
  const read = (event: Event) => {
    const nonce: unknown = (event as CustomEvent).detail;
    if (typeof nonce !== 'string' || !/^[\w-]{36}$/.test(nonce)) return;
    let language = '',
      sourceId = '',
      kind = 'unknown',
      translated = false,
      known = false;
    try {
      const player = document.querySelector('#movie_player') as
        | (Element & {
            getOption?: (module: string, option: string) => unknown;
          })
        | null;
      const track = player?.getOption?.('captions', 'track');
      if (track && typeof track === 'object') {
        const data = track as Record<string, unknown>;
        const allowed = [
          'languageCode',
          'languageName',
          'displayName',
          'kind',
          'name',
          'id',
          'is_servable',
          'is_default',
          'is_translateable',
          'vss_id',
          'translationLanguage',
        ];
        language =
          typeof data.languageCode === 'string'
            ? data.languageCode.slice(0, 35)
            : '';
        sourceId =
          typeof data.vss_id === 'string' ? data.vss_id.slice(0, 128) : '';
        kind =
          data.kind === 'asr' ? 'asr' : data.kind === '' ? 'manual' : 'unknown';
        translated =
          data.translationLanguage !== undefined &&
          data.translationLanguage !== null;
        known =
          language !== '' &&
          sourceId !== '' &&
          kind !== 'unknown' &&
          Object.keys(data).every((key) => allowed.includes(key));
      }
    } catch {
      /* An unavailable/changed player API is an unknown source. */
    }
    const videoId = new URL(location.href).searchParams.get('v') ?? '';
    const key = JSON.stringify([
      videoId,
      language,
      sourceId,
      kind,
      translated,
      known,
    ]);
    if (selected?.key !== key) pending?.abort();
    selected =
      known && !translated ? { videoId, language, sourceId, kind, key } : null;
    document.dispatchEvent(
      new CustomEvent(response, {
        detail: JSON.stringify({
          nonce,
          videoId,
          language,
          sourceId,
          kind,
          translated,
          known,
        }),
      }),
    );
  };
  const timed = (event: Event) => {
    const raw: unknown = (event as CustomEvent).detail;
    if (closed || typeof raw !== 'string' || raw.length > 1024) return;
    let data: { nonce?: unknown; key?: unknown };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return;
    }
    if (
      !data ||
      typeof data.nonce !== 'string' ||
      !/^[\w-]{36}$/.test(data.nonce) ||
      !selected ||
      data.key !== selected.key
    )
      return;
    const track = selected;
    const nonce = data.nonce;
    const reply = (cues: Awaited<ReturnType<typeof readTimedCaptions>>) => {
      if (
        closed ||
        selected?.key !== track.key ||
        location.pathname !== '/watch' ||
        new URL(location.href).searchParams.get('v') !== track.videoId
      )
        return;
      let detail = JSON.stringify({ nonce, key: track.key, cues });
      if (detail.length > TIMED_MAX_BYTES)
        detail = JSON.stringify({ nonce, key: track.key, cues: null });
      document.dispatchEvent(new CustomEvent(TIMED_RESPONSE, { detail }));
    };
    if (attempted.has(track.key) || attempted.size >= 8) {
      reply(null);
      return;
    }
    attempted.add(track.key);
    pending?.abort();
    const abort = new AbortController();
    pending = abort;
    const timer = setTimeout(() => abort.abort(), 5000);
    void (async () => {
      try {
        const player = document.querySelector('#movie_player') as
          (Element & { getPlayerResponse?: () => unknown }) | null;
        const url = selectedTimedUrl(player?.getPlayerResponse?.(), track);
        if (!url) {
          reply(null);
          return;
        }
        const response = await fetch(url, {
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: abort.signal,
        });
        const cues = await readTimedCaptions(response);
        if (!abort.signal.aborted) reply(cues);
      } catch {
        reply(null);
      } finally {
        clearTimeout(timer);
      }
    })();
  };
  const cleanup = () => {
    closed = true;
    pending?.abort();
    document.removeEventListener(request, read);
    document.removeEventListener(TIMED_REQUEST, timed);
    document.removeEventListener('yt-navigate-start', cleanup);
    document.removeEventListener(stop, cleanup);
    window.removeEventListener('pagehide', cleanup);
    delete scope.__subtitleSourceCleanup;
  };
  document.addEventListener(request, read);
  document.addEventListener(TIMED_REQUEST, timed);
  document.addEventListener('yt-navigate-start', cleanup, { once: true });
  document.addEventListener(stop, cleanup);
  window.addEventListener('pagehide', cleanup, { once: true });
  scope.__subtitleSourceCleanup = cleanup;
});
