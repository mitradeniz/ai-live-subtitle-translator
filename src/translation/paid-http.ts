import { retryAfter } from './retry.ts';
import {
  TranslationFailure,
  TranslationJobSchema,
  type TranslationJob,
  type TranslationErrorCode,
} from './contracts.ts';

export function validatePaidInput(key: string, job: TranslationJob) {
  if (
    !TranslationJobSchema.safeParse(job).success ||
    job.items.some((item) => !item.text.trim()) ||
    new Set(job.items.map((item) => item.id)).size !== job.items.length
  )
    throw new TranslationFailure('LIMIT');
  if (!key || key.length > 4096 || !/^[\x21-\x7e]+$/.test(key))
    throw new TranslationFailure('AI_KEY');
}
export async function readBoundedJSON(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
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
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65_536) throw new TranslationFailure('RESPONSE');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new TranslationFailure('RESPONSE');
  }
}
function httpError(status: number, raw: unknown): TranslationErrorCode {
  // Inspect only bounded error data; return fixed codes, never message text or URLs.
  const error =
    typeof raw === 'object' && raw !== null && 'error' in raw
      ? raw.error
      : null;
  const serialized = JSON.stringify(error) ?? '';
  if (
    status === 429 ||
    status === 402 ||
    (status === 403 &&
      /dailyLimitExceeded|userRateLimitExceeded|quotaExceeded|RESOURCE_EXHAUSTED/.test(
        serialized,
      ))
  )
    return 'QUOTA';
  if (
    status === 401 ||
    status === 403 ||
    /API_KEY_INVALID|keyInvalid/.test(serialized)
  )
    return 'AUTH';
  if (
    status === 400 &&
    /unsupported.*language|invalid.*(?:source|target).*language/i.test(
      serialized,
    )
  )
    return 'LANGUAGE';
  if (status === 400 || status === 404) return 'PROVIDER_REQUEST';
  return 'NETWORK';
}
export async function paidJSON(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  timeoutMs = 15_000,
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  try {
    combined.throwIfAborted();
    const response = await request(url, {
      ...init,
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: combined,
    });
    if (response.redirected) {
      await response.body?.cancel();
      throw new TranslationFailure('NETWORK');
    }
    if (!response.ok) {
      const raw = await readBoundedJSON(response, combined).catch(() => null);
      combined.throwIfAborted();
      const quota =
        /insufficient_quota|billing|balance|dailyLimitExceeded|quotaExceeded|RESOURCE_EXHAUSTED/i.test(
          JSON.stringify(raw),
        );
      if (response.status === 429 && !quota)
        throw new TranslationFailure(
          'THROTTLED',
          retryAfter(response.headers.get('retry-after')),
        );
      throw new TranslationFailure(httpError(response.status, raw));
    }
    return await readBoundedJSON(response, combined);
  } catch (error) {
    if (signal.aborted) throw new TranslationFailure('CANCELLED');
    if (timeout.aborted) throw new TranslationFailure('TIMEOUT');
    if (error instanceof TranslationFailure) throw error;
    throw new TranslationFailure('NETWORK');
  }
}
