import {
  parseTimedCaptions,
  readTimedCaptions,
  TIMED_MAX_BYTES,
} from './timed.ts';
import type { Cue } from '../playback/cues.ts';

// Observe only an approved caption response. Never rewrite requests/responses,
// replay signed URLs, read headers, or touch the player's credentials.
export function observeCaptionResponses(
  identify: (url: string) => string | null,
  receive: (key: string, cues: Cue[] | null) => void,
) {
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeFetch = window.fetch;
  const listeners = new Map<XMLHttpRequest, () => void>();
  const abort = new AbortController();
  let closed = false;
  let reads = 0;
  const candidate = (value: string) => {
    try {
      const url = new URL(value, location.href);
      return (
        url.origin === 'https://www.youtube.com' &&
        url.pathname === '/api/timedtext' &&
        !url.username &&
        !url.password &&
        !url.searchParams.has('tlang') &&
        url.searchParams.get('fmt') === 'json3' &&
        url.searchParams.get('v') ===
          new URL(location.href).searchParams.get('v')
      );
    } catch {
      return false;
    }
  };
  function open(
    this: XMLHttpRequest,
    ...args: Parameters<XMLHttpRequest['open']>
  ) {
    listeners.get(this)?.();
    const result = Reflect.apply(nativeOpen, this, args);
    if (
      closed ||
      reads >= 32 ||
      listeners.size >= 8 ||
      args[0].toUpperCase() !== 'GET'
    )
      return result;
    const url = String(args[1]);
    if (!candidate(url)) return result;
    const initialKey = identify(url);
    reads++;
    const cleanup = () => {
      this.removeEventListener('load', load);
      this.removeEventListener('loadend', cleanup);
      listeners.delete(this);
    };
    const load = () =>
      queueMicrotask(() => {
        try {
          const key = identify(this.responseURL);
          if (
            !key ||
            (initialKey && initialKey !== key) ||
            closed ||
            new URL(this.responseURL).href !==
              new URL(url, location.href).href ||
            this.status !== 200
          )
            return;
          let text: string;
          if (this.responseType === '' || this.responseType === 'text')
            text = this.responseText;
          else if (this.responseType === 'json')
            text = JSON.stringify(this.response);
          else if (
            this.responseType === 'arraybuffer' &&
            this.response instanceof ArrayBuffer &&
            this.response.byteLength <= TIMED_MAX_BYTES
          )
            text = new TextDecoder('utf-8', { fatal: true }).decode(
              this.response,
            );
          else return;
          if (
            text.length > TIMED_MAX_BYTES ||
            new TextEncoder().encode(text).byteLength > TIMED_MAX_BYTES
          ) {
            receive(key, null);
            return;
          }
          let cues: Cue[] | null = null;
          try {
            cues = parseTimedCaptions(JSON.parse(text));
          } catch {
            /* Empty/malformed platform response. */
          }
          receive(key, cues);
        } catch {
          /* Page-controlled response is never an extension privilege. */
        }
      });
    listeners.set(this, cleanup);
    this.addEventListener('load', load);
    this.addEventListener('loadend', cleanup, { once: true });
    return result;
  }
  const fetch: typeof window.fetch = function (
    this: Window | undefined,
    input,
    init,
  ) {
    const result = Reflect.apply(nativeFetch, this, [
      input,
      init,
    ]) as Promise<Response>;
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method =
      init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (
      !closed &&
      reads < 32 &&
      method.toUpperCase() === 'GET' &&
      candidate(url)
    ) {
      reads++;
      void result
        .then(async (response) => {
          const key = identify(response.url);
          if (closed || response.redirected || !key) return;
          const cues = await readTimedCaptions(
            response.clone(),
            AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
          );
          if (!closed && identify(response.url) === key) receive(key, cues);
        })
        .catch(() => {});
    }
    return result;
  };
  XMLHttpRequest.prototype.open = open as typeof nativeOpen;
  window.fetch = fetch;
  return () => {
    closed = true;
    abort.abort();
    for (const cleanup of [...listeners.values()]) cleanup();
    // A later extension may have installed a wrapper. Never overwrite its hook.
    if (XMLHttpRequest.prototype.open === open)
      XMLHttpRequest.prototype.open = nativeOpen;
    if (window.fetch === fetch) window.fetch = nativeFetch;
  };
}
