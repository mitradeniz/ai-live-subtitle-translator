import packageJson from '../package.json';
import { observeCaptionResponses } from '../src/youtube/capture.ts';
import type { Cue } from '../src/playback/cues.ts';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import {
  TIMED_REQUEST,
  TIMED_RESPONSE,
  TIMED_MAX_BYTES,
  selectedTimedUrl,
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
    __subtitleSourceResume?: () => void;
    __subtitleSourceVersion?: string;
  };
  if (scope.__subtitleSourceCleanup) {
    if (scope.__subtitleSourceVersion === packageJson.version) {
      scope.__subtitleSourceResume?.();
      return;
    }
    scope.__subtitleSourceCleanup();
  }
  let selected: (TrackIdentity & { key: string }) | null = null;
  let waiting: { nonce: string; key: string } | null = null;
  let cached: { key: string; cues: Cue[] } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let active = true;
  const attempted = new Set<string>();
  const read = (event: Event) => {
    const nonce: unknown = (event as CustomEvent).detail;
    if (!active || typeof nonce !== 'string' || !/^[\w-]{36}$/.test(nonce))
      return;
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
    if (selected?.key !== key) {
      waiting = null;
      cached = null;
      clearTimeout(timer);
    }
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
  const player = () =>
    document.querySelector('#movie_player') as
      | (Element & {
          getPlayerResponse?: () => unknown;
          getOptions?: (module: string) => unknown;
          setOption?: (module: string, option: string, value: boolean) => void;
        })
      | null;
  const reply = (key: string, cues: Cue[] | null) => {
    if (
      closed ||
      !waiting ||
      waiting.key !== key ||
      selected?.key !== key ||
      location.pathname !== '/watch' ||
      new URL(location.href).searchParams.get('v') !== selected.videoId
    )
      return;
    let detail = JSON.stringify({ nonce: waiting.nonce, key, cues });
    if (detail.length > TIMED_MAX_BYTES)
      detail = JSON.stringify({ nonce: waiting.nonce, key, cues: null });
    clearTimeout(timer);
    document.dispatchEvent(new CustomEvent(TIMED_RESPONSE, { detail }));
  };
  const startCapture = () =>
    observeCaptionResponses(
      (url) => {
        read(new CustomEvent(request, { detail: crypto.randomUUID() }));
        if (!selected) return null;
        try {
          const expected = selectedTimedUrl(
            player()?.getPlayerResponse?.(),
            selected,
          );
          const actual = new URL(url, location.href);
          if (
            !expected ||
            actual.origin !== expected.origin ||
            actual.pathname !== expected.pathname ||
            actual.username ||
            actual.password ||
            actual.hash ||
            actual.searchParams.has('tlang') ||
            actual.searchParams.get('fmt') !== 'json3'
          )
            return null;
          for (const name of ['v', 'lang', 'kind', 'name'])
            if (
              actual.searchParams.get(name) !==
                expected.searchParams.get(name) ||
              actual.searchParams.getAll(name).length > 1
            )
              return null;
          return selected.key;
        } catch {
          return null;
        }
      },
      (key, cues) => {
        if (selected?.key !== key) return;
        if (cues) cached = { key, cues };
        reply(key, cues);
      },
    );
  let stopCapture: (() => void) | undefined = startCapture();
  const timed = (event: Event) => {
    const raw: unknown = (event as CustomEvent).detail;
    if (closed || !active || typeof raw !== 'string' || raw.length > 1024)
      return;
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
    waiting = { nonce: data.nonce, key: track.key };
    if (cached?.key === track.key) {
      reply(track.key, cached.cues);
      return;
    }
    if (attempted.has(track.key) || attempted.size >= 8) {
      reply(track.key, null);
      return;
    }
    attempted.add(track.key);
    try {
      const target = player();
      const options = target?.getOptions?.('captions');
      if (
        !selectedTimedUrl(target?.getPlayerResponse?.(), track) ||
        !Array.isArray(options) ||
        !options.includes('reload') ||
        !target?.setOption
      ) {
        reply(track.key, null);
        return;
      }
      // Ask the player to load its own selected track once. No URL replay or token handling.
      timer = setTimeout(() => reply(track.key, null), 5000);
      target.setOption('captions', 'reload', true);
    } catch {
      reply(track.key, null);
    }
  };
  const suspend = (event: Event) => {
    if ((event as CustomEvent).detail === 'purge') {
      cleanup();
      return;
    }
    active = false;
    clearTimeout(timer);
    waiting = null;
    stopCapture?.();
    stopCapture = undefined;
  };
  const resume = () => {
    if (closed) return;
    active = true;
    stopCapture ??= startCapture();
  };
  const expiry = setTimeout(() => cleanup(), 30 * 60_000);
  const cleanup = () => {
    clearTimeout(expiry);
    closed = true;
    active = false;
    clearTimeout(timer);
    stopCapture?.();
    waiting = null;
    cached = null;
    document.removeEventListener(request, read);
    document.removeEventListener(TIMED_REQUEST, timed);
    document.removeEventListener('yt-navigate-start', cleanup);
    document.removeEventListener(stop, suspend);
    window.removeEventListener('pagehide', cleanup);
    delete scope.__subtitleSourceCleanup;
    delete scope.__subtitleSourceResume;
    delete scope.__subtitleSourceVersion;
  };
  document.addEventListener(request, read);
  document.addEventListener(TIMED_REQUEST, timed);
  document.addEventListener('yt-navigate-start', cleanup, { once: true });
  document.addEventListener(stop, suspend);
  window.addEventListener('pagehide', cleanup, { once: true });
  scope.__subtitleSourceCleanup = cleanup;
  scope.__subtitleSourceResume = resume;
  scope.__subtitleSourceVersion = packageJson.version;
});
