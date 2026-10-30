import { GOOGLE_ORIGIN, TranslationFailure } from './contracts.ts';

// A deliberately small language allowlist. This is not Google's official API.
const languages = new Set([
  'en',
  'tr',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'ja',
  'ko',
  'ar',
  'ru',
  'zh-CN',
  'zh-TW',
]);
export function googleLanguage(value: string, source = false): string {
  if (source && value === 'auto') return 'auto';
  const normalized = value.toLowerCase();
  const mapped =
    normalized === 'zh-tw' || normalized === 'zh-hant'
      ? 'zh-TW'
      : ['zh', 'zh-cn', 'zh-hans'].includes(normalized)
        ? 'zh-CN'
        : (normalized.split('-')[0] ?? '');
  if (!languages.has(mapped)) throw new TranslationFailure('LANGUAGE');
  return mapped;
}

export function parseGoogleResponse(raw: unknown): string {
  if (
    !Array.isArray(raw) ||
    !Array.isArray(raw[0]) ||
    !raw[0].length ||
    raw[0].length > 64
  )
    throw new TranslationFailure('RESPONSE');
  const segments: string[] = [];
  for (const segment of raw[0]) {
    if (
      !Array.isArray(segment) ||
      typeof segment[0] !== 'string' ||
      typeof segment[1] !== 'string'
    )
      throw new TranslationFailure('RESPONSE');
    segments.push(segment[0]);
  }
  const text = segments.join('');
  if (!text.trim() || text.length > 4000)
    throw new TranslationFailure('RESPONSE');
  return text;
}

export async function translateGoogle(
  text: string,
  source: string,
  target: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<string> {
  if (!text.trim() || text.length > 1000) throw new TranslationFailure('LIMIT');
  const url = new URL('/translate_a/single', GOOGLE_ORIGIN);
  for (const [key, value] of Object.entries({
    client: 'gtx',
    sl: googleLanguage(source, true),
    tl: googleLanguage(target),
    dt: 't',
    q: text,
  }))
    url.searchParams.set(key, value);
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  try {
    combined.throwIfAborted();
    const response = await request(url, {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: combined,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new TranslationFailure(
        [401, 403, 429].includes(response.status) ? 'BLOCKED' : 'NETWORK',
      );
    }
    if (
      !response.headers.get('content-type')?.includes('application/json') ||
      !response.body
    ) {
      await response.body?.cancel();
      throw new TranslationFailure('RESPONSE');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        combined.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 32_768) throw new TranslationFailure('RESPONSE');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    combined.throwIfAborted();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new TranslationFailure('RESPONSE');
    }
    return parseGoogleResponse(parsed);
  } catch (error) {
    if (signal.aborted) throw new TranslationFailure('CANCELLED');
    if (timeout.aborted) throw new TranslationFailure('TIMEOUT');
    if (error instanceof TranslationFailure) throw error;
    throw new TranslationFailure('NETWORK');
  }
}
