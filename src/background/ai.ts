import { z } from '../messaging/schema.ts';
import type { Settings } from '../messaging/protocol.ts';
import {
  AI_ORIGIN,
  AIProfileSchema,
  DEFAULT_AI_PROFILE,
} from '../translation/ai-profile.ts';
import {
  TranslationFailure,
  type TranslationJob,
} from '../translation/contracts.ts';
import { translateAI } from '../translation/openai.ts';
import { BoundaryError } from './errors.ts';
import type { CredentialStore } from './credentials.ts';
import type { TrustedStorage } from './storage.ts';

export interface AIPorts {
  permitted(): Promise<boolean>;
  fetch?: typeof fetch;
  now?: () => number;
}
const PROFILE = 'ai-profile.v1';
const QUOTA = 'ai.quota.v1';
const QuotaSchema = z.strictObject({
  schemaVersion: z.literal(1),
  started: z.number().finite().nonnegative(),
  count: z.number().int().min(0).max(10),
  total: z.number().int().min(0).max(100),
  last: z.number().finite().nonnegative(),
  blocked: z.boolean(),
});
export class AICoordinator {
  #storage: TrustedStorage;
  #credentials: CredentialStore;
  #ports: AIPorts;
  #epoch = 0;
  #job:
    | {
        tabId: number;
        sessionId: string;
        jobId: string;
        abort: AbortController;
      }
    | undefined;
  #cancelled = new Set<string>();
  constructor(
    storage: TrustedStorage,
    credentials: CredentialStore,
    ports: AIPorts,
  ) {
    this.#storage = storage;
    this.#credentials = credentials;
    this.#ports = ports;
  }
  async profile() {
    const profile = await this.#storage.run(async ({ local }) => {
      const raw = (await local.get(PROFILE))[PROFILE];
      if (raw === undefined) return DEFAULT_AI_PROFILE;
      const parsed = AIProfileSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    });
    // Corrupt or unsupported origins never inherit an existing credential.
    if (!profile) {
      await this.#credentials.delete('ai');
      throw new TranslationFailure('AI_PROFILE');
    }
    return profile;
  }
  async configure(raw: unknown) {
    this.cancelAll();
    const epoch = this.#epoch;
    const parsed = AIProfileSchema.safeParse(raw);
    if (!parsed.success) throw new BoundaryError('INVALID_MESSAGE');
    try {
      await this.profile();
    } catch (error) {
      if (!(error instanceof TranslationFailure) || error.code !== 'AI_PROFILE')
        throw error;
    }
    await this.#credentials.readForOrigin(
      'ai',
      new URL(parsed.data.endpoint).origin,
    );
    await this.#storage.run(async ({ local }) => {
      if (epoch === this.#epoch) await local.set({ [PROFILE]: parsed.data });
    });
  }
  permitted() {
    return this.#ports.permitted();
  }
  cancelAll() {
    this.#epoch++;
    this.#job?.abort.abort();
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
  async keyChanged() {
    this.cancelAll();
    await this.#storage.run(async ({ session }) => {
      const parsed = QuotaSchema.safeParse((await session.get(QUOTA))[QUOTA]);
      if (parsed.success)
        await session.set({ [QUOTA]: { ...parsed.data, blocked: false } });
    });
  }
  async #reserve() {
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
      if (quota.blocked) return 'AI_BLOCKED' as const;
      if (now - quota.started >= 60_000) {
        quota.started = now;
        quota.count = 0;
      }
      if (
        quota.total >= 100 ||
        quota.count >= 10 ||
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
    const check = () => {
      valid();
      if (current.abort.signal.aborted || epoch !== this.#epoch)
        throw new TranslationFailure('CANCELLED');
    };
    try {
      check();
      if (settings.displayMode === 'original')
        throw new TranslationFailure('OFF');
      const profile = await this.profile();
      check();
      if (!(await this.permitted())) throw new TranslationFailure('PERMISSION');
      const key = await this.#credentials.readForOrigin('ai', AI_ORIGIN);
      check();
      if (!key) throw new TranslationFailure('AI_KEY');
      await this.#reserve();
      check();
      if (!(await this.permitted())) throw new TranslationFailure('PERMISSION');
      check();
      const result = await translateAI(
        profile,
        key,
        job,
        settings.sourceLanguage,
        settings.targetLanguage,
        current.abort.signal,
        this.#ports.fetch,
      );
      check();
      if (!(await this.permitted())) throw new TranslationFailure('PERMISSION');
      check();
      return result;
    } catch (error) {
      if (
        error instanceof TranslationFailure &&
        error.code === 'AI_BLOCKED' &&
        epoch === this.#epoch
      ) {
        await this.#storage.run(async ({ session }) => {
          const parsed = QuotaSchema.safeParse(
            (await session.get(QUOTA))[QUOTA],
          );
          if (parsed.success && epoch === this.#epoch)
            await session.set({ [QUOTA]: { ...parsed.data, blocked: true } });
        });
      }
      throw error;
    } finally {
      if (this.#job === current) this.#job = undefined;
    }
  }
}
