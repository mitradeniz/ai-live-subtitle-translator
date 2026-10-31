import { RetryGate } from './retry-gate.ts';
import { z } from '../messaging/schema.ts';
import type { Settings } from '../messaging/protocol.ts';
import {
  TranslationFailure,
  type TranslationJob,
} from '../translation/contracts.ts';
import {
  googleLanguage,
  translateGoogle,
} from '../translation/google-keyless.ts';
import { BoundaryError } from './errors.ts';
import type { TrustedStorage } from './storage.ts';

export interface GooglePorts {
  permitted(): Promise<boolean>;
  fetch?: typeof fetch;
  now?: () => number;
}
const CONSENT = 'google-keyless.v1';
const QUOTA = 'google-keyless.quota.v1';
const QuotaSchema = z.strictObject({
  schemaVersion: z.literal(1),
  started: z.number().finite().nonnegative(),
  count: z.number().int().min(0).max(20),
  total: z.number().int().min(0).max(200),
  last: z.number().finite().nonnegative(),
  blocked: z.boolean(),
});
type Job = {
  tabId: number;
  sessionId: string;
  jobId: string;
  abort: AbortController;
};

export class GoogleCoordinator {
  #storage: TrustedStorage;
  #ports: GooglePorts;
  #job: Job | undefined;
  #epoch = 0;
  #retry: RetryGate;
  #cancelled = new Set<string>();
  constructor(storage: TrustedStorage, ports: GooglePorts) {
    this.#storage = storage;
    this.#ports = ports;
    this.#retry = new RetryGate(storage, 'google.retry.v1', ports.now);
  }
  async enabled(): Promise<boolean> {
    const consent = await this.#storage.run(async ({ local }) => {
      const raw = (await local.get(CONSENT))[CONSENT];
      return (
        typeof raw === 'object' &&
        raw !== null &&
        'schemaVersion' in raw &&
        raw.schemaVersion === 1 &&
        'enabled' in raw &&
        raw.enabled === true &&
        Object.keys(raw).length === 2
      );
    });
    return consent && (await this.#ports.permitted());
  }
  async setEnabled(enabled: boolean) {
    this.cancelAll();
    const epoch = this.#epoch;
    if (enabled && !(await this.#ports.permitted()))
      throw new BoundaryError('UNAVAILABLE');
    await this.#storage.run(async ({ local }) => {
      if (epoch === this.#epoch)
        await local.set({ [CONSENT]: { schemaVersion: 1, enabled } });
    });
    return epoch === this.#epoch && (await this.enabled());
  }
  cancelAll() {
    this.#epoch++;
    this.#job?.abort.abort();
  }
  cancelSession(sessionId: string) {
    if (this.#job?.sessionId === sessionId) this.#job.abort.abort();
  }
  cancelTab(tabId: number) {
    if (this.#job?.tabId === tabId) this.#job.abort.abort();
  }
  cancel(sessionId: string, jobId: string) {
    if (this.#job?.sessionId === sessionId && this.#job.jobId === jobId)
      this.#job.abort.abort();
    else {
      if (this.#cancelled.size >= 128)
        this.#cancelled.delete(this.#cancelled.values().next().value!);
      this.#cancelled.add(`${sessionId}:${jobId}`);
    }
  }
  async #reserve(): Promise<void> {
    // Serialize and persist the budget before dispatch, so worker restarts cannot reset it.
    const code = await this.#storage.run(async ({ session }) => {
      const now = (this.#ports.now ?? Date.now)();
      const raw = (await session.get(QUOTA))[QUOTA];
      const parsed = QuotaSchema.safeParse(raw);
      if (raw !== undefined && !parsed.success) return 'LIMIT' as const;
      const quota = parsed.success
        ? parsed.data
        : {
            schemaVersion: 1 as const,
            started: now,
            count: 0,
            total: 0,
            last: 0,
            blocked: false,
          };
      if (quota.blocked) return 'BLOCKED' as const;
      if (now - quota.started >= 60_000) {
        quota.started = now;
        quota.count = 0;
      }
      if (
        quota.total >= 200 ||
        quota.count >= 20 ||
        (quota.total > 0 && now - quota.last < 1000)
      )
        return 'LIMIT' as const;
      quota.count++;
      quota.total++;
      quota.last = now;
      await session.set({ [QUOTA]: quota });
      return null;
    });
    if (code) throw new TranslationFailure(code);
  }
  async translate(
    tabId: number,
    sessionId: string,
    job: TranslationJob,
    settings: Settings,
    valid: () => void,
  ) {
    if (this.#cancelled.delete(`${sessionId}:${job.jobId}`))
      throw new TranslationFailure('CANCELLED');
    if (this.#job) throw new TranslationFailure('BUSY');
    const current = {
      tabId,
      sessionId,
      jobId: job.jobId,
      abort: new AbortController(),
    };
    this.#job = current;
    const epoch = this.#epoch;
    const signal = current.abort.signal;
    const check = () => {
      valid();
      if (signal.aborted || epoch !== this.#epoch)
        throw new TranslationFailure('CANCELLED');
    };
    try {
      check();
      if (!(await this.enabled()) || settings.displayMode === 'original')
        throw new TranslationFailure('OFF');
      googleLanguage(settings.sourceLanguage, true);
      googleLanguage(settings.targetLanguage);
      const items = [];
      for (const item of job.items) {
        check();
        const text = await this.#retry.run(
          async () => {
            await this.#reserve();
            check();
            if (!(await this.#ports.permitted()))
              throw new TranslationFailure('PERMISSION');
            check();
            const translated = await translateGoogle(
              item.text,
              settings.sourceLanguage,
              settings.targetLanguage,
              signal,
              this.#ports.fetch,
            );
            check();
            if (!(await this.#ports.permitted()))
              throw new TranslationFailure('PERMISSION');
            return translated;
          },
          false,
          signal,
          check,
        );
        items.push({ id: item.id, revision: item.revision, text });
        // Separate requests preserve cue alignment; wait without dispatching on cancellation.
        if (items.length < job.items.length)
          await new Promise<void>((resolve, reject) => {
            const cancel = () => {
              clearTimeout(timer);
              reject(new TranslationFailure('CANCELLED'));
            };
            const timer = setTimeout(() => {
              signal.removeEventListener('abort', cancel);
              resolve();
            }, 1050);
            signal.addEventListener('abort', cancel, { once: true });
            if (signal.aborted) cancel();
          });
      }
      check();
      return { generation: job.generation, items };
    } catch (error) {
      if (error instanceof TranslationFailure && error.code === 'BLOCKED') {
        await this.#storage.run(async ({ session }) => {
          const parsed = QuotaSchema.safeParse(
            (await session.get(QUOTA))[QUOTA],
          );
          if (parsed.success)
            await session.set({ [QUOTA]: { ...parsed.data, blocked: true } });
        });
      }
      throw error;
    } finally {
      if (this.#job === current) this.#job = undefined;
    }
  }
}
