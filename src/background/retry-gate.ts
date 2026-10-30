import { z } from '../messaging/schema.ts';
import { TranslationFailure } from '../translation/contracts.ts';
import { waitFor } from '../translation/retry.ts';
import type { TrustedStorage } from './storage.ts';
const State = z.strictObject({
  until: z.number().finite().nonnegative(),
  failures: z.number().int().min(0).max(3),
});
export class RetryGate {
  private storage: TrustedStorage;
  private key: string;
  private now: () => number;
  private random: () => number;
  constructor(
    storage: TrustedStorage,
    key: string,
    now = Date.now,
    random = Math.random,
  ) {
    this.storage = storage;
    this.key = key;
    this.now = now;
    this.random = random;
  }
  async run<T>(
    operation: () => Promise<T>,
    paid: boolean,
    signal: AbortSignal,
    valid: () => void,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      valid();
      const state = await this.storage.run(async ({ session }) => {
        const raw = (await session.get(this.key))[this.key];
        if (raw === undefined) return { until: 0, failures: 0 };
        const parsed = State.safeParse(raw);
        return parsed.success
          ? parsed.data
          : { until: this.now() + 60_000, failures: 3 };
      });
      valid();
      if (state.until > this.now()) throw new TranslationFailure('COOLDOWN');
      try {
        const result = await operation();
        valid();
        await this.storage.run(({ session }) => session.remove(this.key));
        return result;
      } catch (error) {
        valid();
        if (!(error instanceof TranslationFailure)) throw error;
        const transient =
          error.code === 'THROTTLED' ||
          ['NETWORK', 'TIMEOUT'].includes(error.code);
        if (!transient) throw error;
        const failures = Math.min(3, state.failures + 1);
        const delay = Math.max(
          error.retryAfterMs ?? 0,
          1100 * 2 ** attempt + Math.floor(this.random() * 400),
          failures >= 3 ? 30_000 : 0,
        );
        const until = Math.min(Number.MAX_SAFE_INTEGER, this.now() + delay);
        await this.storage.run(({ session }) =>
          session.set({ [this.key]: { until, failures } }),
        );
        // A network failure on a paid request may already have incurred a charge.
        if (
          (paid && error.code !== 'THROTTLED') ||
          attempt >= (paid ? 1 : 2) ||
          delay > 5000
        )
          throw error;
        await waitFor(delay, signal);
      }
    }
  }
}
