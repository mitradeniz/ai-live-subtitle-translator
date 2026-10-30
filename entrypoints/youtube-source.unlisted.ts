import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

// MAIN-world data reader only. No extension API, fetch, caption text, or endpoints.
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
    document.dispatchEvent(
      new CustomEvent(response, {
        detail: JSON.stringify({
          nonce,
          videoId: new URL(location.href).searchParams.get('v') ?? '',
          language,
          sourceId,
          kind,
          translated,
          known,
        }),
      }),
    );
  };
  const cleanup = () => {
    document.removeEventListener(request, read);
    document.removeEventListener(stop, cleanup);
    window.removeEventListener('pagehide', cleanup);
    delete scope.__subtitleSourceCleanup;
  };
  document.addEventListener(request, read);
  document.addEventListener(stop, cleanup);
  window.addEventListener('pagehide', cleanup, { once: true });
  scope.__subtitleSourceCleanup = cleanup;
});
