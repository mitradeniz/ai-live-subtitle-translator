import { z } from '../messaging/schema.ts';
import type { TrustedStorage } from './storage.ts';
import type { TranslationJob } from '../translation/contracts.ts';
import type { CaptionResult } from '../playback/cues.ts';
const KEY = 'translation-cache.v1';
const POLICY = 'cache-policy.v1';
const Policy = z.strictObject({
  schemaVersion: z.literal(1),
  persistent: z.boolean(),
});
const Entries = z
  .array(
    z.strictObject({
      key: z.string().regex(/^[a-f0-9]{64}$/),
      expires: z.number().finite().nonnegative(),
      texts: z.array(z.string().min(1).max(4000)).min(1).max(4),
    }),
  )
  .max(128);
const MAX_BYTES = 262_144;
export async function cacheIdentity(
  config: unknown,
  job: TranslationJob,
): Promise<string> {
  // Ordered batch text is also AI context. Never normalize whitespace or omit context.
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      schema: 1,
      config,
      prompt: 'caption-batch-v1',
      glossary: 'none-v1',
      context: job.items.map((i) => i.text),
      text: job.items.map((i) => i.text),
    }),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export class WorkCache {
  #storage: TrustedStorage;
  #now: () => number;
  #epoch = 0;
  constructor(storage: TrustedStorage, now = Date.now) {
    this.#storage = storage;
    this.#now = now;
  }
  #entries(raw: unknown) {
    if (
      new TextEncoder().encode(JSON.stringify(raw ?? '')).byteLength > MAX_BYTES
    )
      return [];
    const parsed = Entries.safeParse(raw);
    return parsed.success
      ? parsed.data.filter(
          (e) =>
            e.expires > this.#now() && e.expires <= this.#now() + 86_400_000,
        )
      : [];
  }
  async policy() {
    return this.#storage.run(async ({ local }) => {
      const parsed = Policy.safeParse((await local.get(POLICY))[POLICY]);
      return parsed.success && parsed.data.persistent;
    });
  }
  async configure(persistent: boolean) {
    this.#epoch++;
    await this.#storage.run(async ({ local }) => {
      await local.set({ [POLICY]: { schemaVersion: 1, persistent } });
      if (!persistent) await local.remove(KEY);
    });
  }
  async clear() {
    this.#epoch++;
    await this.#storage.run(async ({ session, local }) => {
      await session.remove(KEY);
      await local.remove(KEY);
    });
  }
  async get(key: string, job: TranslationJob): Promise<CaptionResult | null> {
    const persistent = await this.policy();
    return this.#storage.run(async ({ session, local }) => {
      for (const area of persistent ? [session, local] : [session]) {
        const entries = this.#entries((await area.get(KEY))[KEY]);
        const hit = entries.find(
          (e) => e.key === key && e.texts.length === job.items.length,
        );
        // Prune expiry on access; moving a hit to the end gives bounded LRU eviction.
        await area.set({
          [KEY]: hit ? [...entries.filter((e) => e !== hit), hit] : entries,
        });
        if (hit)
          return {
            generation: job.generation,
            items: job.items.map((item, i) => ({
              id: item.id,
              revision: item.revision,
              text: hit.texts[i]!,
            })),
          };
      }
      return null;
    });
  }
  async put(key: string, result: CaptionResult, valid: () => void) {
    const epoch = this.#epoch;
    const persistent = await this.policy();
    valid();
    await this.#storage.run(async ({ session, local }) => {
      if (epoch !== this.#epoch) return;
      // valid can throw a domain error; check it outside the trusted storage latch.
      const texts = result.items.map((i) => i.text);
      for (const area of persistent ? [session, local] : [session]) {
        const entries = this.#entries((await area.get(KEY))[KEY]).filter(
          (e) => e.key !== key,
        );
        entries.push({
          key,
          texts,
          expires: this.#now() + (area === local ? 86_400_000 : 1_800_000),
        });
        while (
          entries.length > 128 ||
          new TextEncoder().encode(JSON.stringify(entries)).byteLength >
            MAX_BYTES
        )
          entries.shift();
        await area.set({ [KEY]: entries });
      }
    });
    valid();
  }
}
