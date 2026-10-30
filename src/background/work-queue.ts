import { waitFor } from '../translation/retry.ts';
import { z } from '../messaging/schema.ts';
import {
  TranslationFailure,
  type TranslationJob,
} from '../translation/contracts.ts';
import type { CaptionResult } from '../playback/cues.ts';
import type { TrustedStorage } from './storage.ts';
import { WorkCache, cacheIdentity } from './work-cache.ts';
const JOURNAL = 'translation-jobs.v1';
const Records = z
  .array(
    z.strictObject({
      key: z.string().length(64),
      sessionId: z.string().max(128),
      jobId: z.uuid(),
      tabId: z.number().int().nonnegative(),
      generation: z.number().int().nonnegative(),
      attempts: z.number().int().min(1).max(2),
      expires: z.number().finite(),
      paid: z.boolean(),
    }),
  )
  .max(32);
type Work = {
  provider: string;
  config: unknown;
  paid: boolean;
  tabId: number;
  sessionId: string;
  job: TranslationJob;
  valid: () => void;
  perform: (valid: () => void) => Promise<CaptionResult>;
  cancel?: () => void;
};
type Entry = {
  work: Work;
  cancelled: boolean;
  started: boolean;
  promise: Promise<CaptionResult>;
  resolve: (result: CaptionResult) => void;
  reject: (error: unknown) => void;
  created: number;
  timer?: ReturnType<typeof setTimeout>;
};
export class WorkQueue {
  readonly cache: WorkCache;
  #storage: TrustedStorage;
  #entries: Entry[] = [];
  #active = new Set<string>();
  #next = new Map<string, number>();
  #now: () => number;
  #deadline: number;
  constructor(storage: TrustedStorage, now = Date.now, deadlineMs = 25_000) {
    this.#deadline = deadlineMs;
    this.#storage = storage;
    this.#now = now;
    this.cache = new WorkCache(storage, now);
  }
  run(work: Work): Promise<CaptionResult> {
    work.valid();
    const duplicate = this.#entries.find(
      (e) =>
        e.work.sessionId === work.sessionId &&
        e.work.job.jobId === work.job.jobId,
    );
    if (duplicate) {
      if (JSON.stringify(duplicate.work.job) !== JSON.stringify(work.job))
        return Promise.reject(new TranslationFailure('RESPONSE'));
      return duplicate.promise;
    }
    if (
      this.#entries.length >= 16 ||
      this.#entries.filter((e) => e.work.tabId === work.tabId).length >= 2
    )
      return Promise.reject(new TranslationFailure('LIMIT'));
    let resolve!: Entry['resolve'];
    let reject!: Entry['reject'];
    const promise = new Promise<CaptionResult>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const entry: Entry = {
      work,
      cancelled: false,
      started: false,
      promise,
      resolve,
      reject,
      created: this.#now(),
    };
    entry.timer = setTimeout(() => {
      entry.cancelled = true;
      work.cancel?.();
      entry.reject(new TranslationFailure('CANCELLED'));
      if (!entry.started)
        this.#entries = this.#entries.filter((e) => e !== entry);
    }, this.#deadline);
    this.#entries.push(entry);
    this.#pump();
    return promise;
  }
  cancel(sessionId?: string, jobId?: string, tabId?: number) {
    for (const entry of this.#entries) {
      if (
        (sessionId === undefined || entry.work.sessionId === sessionId) &&
        (jobId === undefined || entry.work.job.jobId === jobId) &&
        (tabId === undefined || entry.work.tabId === tabId)
      ) {
        entry.cancelled = true;
        if (!entry.started) {
          clearTimeout(entry.timer);
          entry.reject(new TranslationFailure('CANCELLED'));
        }
      }
    }
    this.#entries = this.#entries.filter((e) => e.started || !e.cancelled);
  }
  async dropTab(tabId: number) {
    this.cancel(undefined, undefined, tabId);
    await this.#storage.run(async ({ session }) => {
      const parsed = Records.safeParse((await session.get(JOURNAL))[JOURNAL]);
      if (parsed.success)
        await session.set({
          [JOURNAL]: parsed.data.filter(
            (r) => r.tabId !== tabId && r.expires > this.#now(),
          ),
        });
    });
  }
  async clearData() {
    this.cancel();
    await this.cache.clear();
    await this.cache.configure(false);
  }
  #pump() {
    const waiting = this.#entries
      .filter((e) => !e.started)
      .sort(
        (a, b) =>
          Number(a.work.job.priority === 'prefetch') -
            Number(b.work.job.priority === 'prefetch') || a.created - b.created,
      );
    for (const entry of waiting) {
      if (this.#active.has(entry.work.provider)) continue;
      entry.started = true;
      this.#active.add(entry.work.provider);
      void this.#execute(entry)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          clearTimeout(entry.timer);
          this.#active.delete(entry.work.provider);
          this.#next.set(entry.work.provider, this.#now() + 1100);
          this.#entries = this.#entries.filter((e) => e !== entry);
          this.#pump();
        });
    }
  }
  async #execute(entry: Entry): Promise<CaptionResult> {
    const { work } = entry;
    const valid = () => {
      work.valid();
      if (entry.cancelled || this.#now() - entry.created >= this.#deadline)
        throw new TranslationFailure('CANCELLED');
    };
    valid();
    const key = await cacheIdentity(work.config, work.job);
    const hit = await this.cache.get(key, work.job);
    valid();
    if (hit) return hit;
    const delay = (this.#next.get(work.provider) ?? 0) - this.#now();
    if (delay > 0) await waitFor(delay, AbortSignal.timeout(25_000));
    valid();
    const allowed = await this.#storage.run(async ({ session }) => {
      const raw = (await session.get(JOURNAL))[JOURNAL];
      const parsed = Records.safeParse(raw ?? []);
      if (!parsed.success) return false;
      const records = parsed.data.filter((r) => r.expires > this.#now());
      const prior = records.find((r) => r.key === key);
      if (prior && (prior.paid || prior.attempts >= 2)) return false;
      if (!prior && records.length >= 32) return false;
      if (prior) records.splice(records.indexOf(prior), 1);
      records.push({
        key,
        sessionId: work.sessionId,
        jobId: work.job.jobId,
        tabId: work.tabId,
        generation: work.job.generation,
        paid: work.paid,
        attempts: (prior?.attempts ?? 0) + 1,
        expires: this.#now() + 1_800_000,
      });
      await session.set({ [JOURNAL]: records });
      return true;
    });
    valid();
    if (!allowed) throw new TranslationFailure('INTERRUPTED');
    try {
      const result = await work.perform(valid);
      valid();
      if (
        result.generation !== work.job.generation ||
        result.items.length !== work.job.items.length ||
        new Set(result.items.map((i) => i.id)).size !== result.items.length ||
        result.items.some(
          (i) =>
            !i.text.trim() ||
            i.text.length > 4000 ||
            !work.job.items.some(
              (source) => source.id === i.id && source.revision === i.revision,
            ),
        )
      )
        throw new TranslationFailure('RESPONSE');
      result.items = work.job.items.map((source) =>
        result.items.find((i) => i.id === source.id)!,
      );
      await this.cache.put(key, result, valid);
      await this.#remove(key, work.job.jobId);
      valid();
      return result;
    } catch (error) {
      // Uncertain paid work stays checkpointed for 30 minutes, including cancellation.
      const uncertain =
        !(error instanceof TranslationFailure) ||
        ['NETWORK', 'TIMEOUT', 'CANCELLED'].includes(error.code);
      if (!work.paid || !uncertain) await this.#remove(key, work.job.jobId);
      throw error;
    }
  }
  async #remove(key: string, jobId: string) {
    await this.#storage.run(async ({ session }) => {
      const parsed = Records.safeParse((await session.get(JOURNAL))[JOURNAL]);
      if (parsed.success)
        await session.set({
          [JOURNAL]: parsed.data.filter(
            (r) =>
              !(r.key === key && r.jobId === jobId) && r.expires > this.#now(),
          ),
        });
    });
  }
}
