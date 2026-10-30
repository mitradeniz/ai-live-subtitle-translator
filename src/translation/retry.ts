import { TranslationFailure } from './contracts.ts';

// A server delay is a lower bound, never shortened to fit a local retry budget.
export function retryAfter(value: string | null, now = Date.now()): number {
  if (!value || value.length > 128) return 30_000;
  const seconds = /^\d+$/.test(value) ? Number(value) * 1000 : NaN;
  const delay = Number.isFinite(seconds) ? seconds : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(1000, delay) : 30_000;
}
export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new TranslationFailure('CANCELLED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
