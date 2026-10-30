import { z } from '../messaging/schema.ts';
import type { TrustedStorage } from './storage.ts';
import { BoundaryError } from './errors.ts';
export const YOUTUBE_HOST = 'https://www.youtube.com/*';
export const YOUTUBE_ORIGIN = 'https://www.youtube.com';
const KEY = 'site-preferences.v1';
const PAUSED = 'site-paused-tabs.v1';
const Schema = z.strictObject({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  originalConfirmed: z.boolean(),
});
const Paused = z.array(z.number().int().nonnegative()).max(128);
export interface SitePorts {
  permitted(): Promise<boolean>;
  changed(): Promise<void>;
  activate(tabId: number, documentId: string): Promise<void>;
}
export class SitePreferences {
  #storage: TrustedStorage;
  #ports: SitePorts;
  #recent = new Map<number, number>();
  constructor(storage: TrustedStorage, ports: SitePorts) {
    this.#storage = storage;
    this.#ports = ports;
  }
  async enabled() {
    const saved = await this.#storage.run(async ({ local }) =>
      Schema.safeParse((await local.get(KEY))[KEY]),
    );
    return (
      saved.success &&
      saved.data.enabled &&
      saved.data.originalConfirmed &&
      (await this.#ports.permitted())
    );
  }
  async configure(enabled: boolean, confirmed: boolean) {
    if (enabled && (!confirmed || !(await this.#ports.permitted())))
      throw new BoundaryError('FORBIDDEN');
    await this.#storage.run(({ local }) =>
      local.set({
        [KEY]: {
          schemaVersion: 1,
          enabled,
          originalConfirmed: enabled && confirmed,
        },
      }),
    );
  }
  async pause(tabId: number, paused = true) {
    await this.#storage.run(async ({ session }) => {
      const saved = Paused.safeParse((await session.get(PAUSED))[PAUSED]);
      const tabs = (saved.success ? saved.data : []).filter(
        (id) => id !== tabId,
      );
      if (paused) tabs.push(tabId);
      await session.set({ [PAUSED]: tabs.slice(-128) });
    });
  }
  async allowed(tabId: number) {
    if (!(await this.enabled())) return false;
    const paused = await this.#storage.run(async ({ session }) => {
      const parsed = Paused.safeParse((await session.get(PAUSED))[PAUSED]);
      return parsed.success && parsed.data.includes(tabId);
    });
    return !paused;
  }
  async activate(tabId: number, documentId: string) {
    if (!(await this.enabled())) throw new BoundaryError('FORBIDDEN');
    if (!(await this.allowed(tabId))) return;
    // Untrusted page mutations cannot create an unbounded injection loop.
    if (Date.now() - (this.#recent.get(tabId) ?? 0) < 2000)
      throw new BoundaryError('BUSY');
    if (this.#recent.size >= 128)
      this.#recent.delete(this.#recent.keys().next().value!);
    this.#recent.set(tabId, Date.now());
    await this.#ports.activate(tabId, documentId);
  }
  changed() {
    return this.#ports.changed();
  }
}
