import { z } from '../messaging/schema.ts';
import type { TrustedStorage } from './storage.ts';
import { BoundaryError } from './errors.ts';

export const EDGE_ALL_KEY = 'edge-all-sites.v1';
export const EDGE_ALL_HOSTS = ['https://*/*', 'http://*/*'];
export const EDGE_SITES_KEY = 'edge-sites.v1';
// Sites where the logo was hidden from its own menu. They override all-sites
// mode until shown again from the popup.
export const EDGE_HIDDEN_KEY = 'edge-hidden-sites.v1';
// Chrome host grants cannot distinguish ports. Keep policy equally explicit.
export function edgeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hostname.includes('*')
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
export const EdgeOriginSchema = z
  .string()
  .max(512)
  .refine((v) => edgeOrigin(v) === v);
const Saved = z.strictObject({
  schemaVersion: z.literal(1),
  origins: z.array(EdgeOriginSchema).max(64),
});
const Hidden = z.strictObject({
  schemaVersion: z.literal(1),
  origins: z.array(EdgeOriginSchema).max(256),
});
export interface EdgeSitePorts {
  allPermitted?(): Promise<boolean>;
  current(): Promise<{ origin: string; tabId: number } | null>;
  permitted(origin: string): Promise<boolean>;
  changed(): Promise<void>;
  activate(
    tabId: number,
    documentId: string,
    authorized: () => Promise<boolean>,
  ): Promise<void>;
}
export class EdgeSites {
  #storage: TrustedStorage;
  #ports: EdgeSitePorts;
  #recent = new Map<string, number>();
  constructor(storage: TrustedStorage, ports: EdgeSitePorts) {
    this.#storage = storage;
    this.#ports = ports;
  }
  async origins() {
    return this.#storage.run(async ({ local }) => {
      const saved = Saved.safeParse(
        (await local.get(EDGE_SITES_KEY))[EDGE_SITES_KEY],
      );
      return saved.success ? saved.data.origins : [];
    });
  }
  async hidden() {
    return this.#storage.run(async ({ local }) => {
      const saved = Hidden.safeParse(
        (await local.get(EDGE_HIDDEN_KEY))[EDGE_HIDDEN_KEY],
      );
      return saved.success ? saved.data.origins : [];
    });
  }
  async #setHidden(origin: string, hidden: boolean) {
    await this.#storage.run(async ({ local }) => {
      const parsed = Hidden.safeParse(
        (await local.get(EDGE_HIDDEN_KEY))[EDGE_HIDDEN_KEY],
      );
      const origins = (parsed.success ? parsed.data.origins : []).filter(
        (value) => value !== origin,
      );
      if (hidden) origins.push(origin);
      // Keep the newest choices if the list ever fills up.
      await local.set({
        [EDGE_HIDDEN_KEY]: { schemaVersion: 1, origins: origins.slice(-256) },
      });
    });
  }
  // Hide the logo on one site from its own menu. This only removes access.
  async hide(origin: string) {
    if (edgeOrigin(origin) !== origin) throw new BoundaryError('FORBIDDEN');
    await this.#setHidden(origin, true);
    await this.#storage.run(async ({ local }) => {
      const parsed = Saved.safeParse(
        (await local.get(EDGE_SITES_KEY))[EDGE_SITES_KEY],
      );
      if (parsed.success && parsed.data.origins.includes(origin))
        await local.set({
          [EDGE_SITES_KEY]: {
            schemaVersion: 1,
            origins: parsed.data.origins.filter((value) => value !== origin),
          },
        });
    });
    await this.#ports.changed();
  }
  async allEnabled() {
    const enabled = await this.#storage.run(
      async ({ local }) =>
        (await local.get(EDGE_ALL_KEY))[EDGE_ALL_KEY] === true,
    );
    return enabled && !!(await this.#ports.allPermitted?.());
  }
  async configureAll(enabled: boolean) {
    if (enabled && !(await this.#ports.allPermitted?.()))
      throw new BoundaryError('FORBIDDEN');
    await this.#storage.run(async ({ local }) => {
      await local.set({ [EDGE_ALL_KEY]: enabled });
      // Turning all sites on or off starts from a clean slate.
      await local.remove(
        enabled ? EDGE_HIDDEN_KEY : [EDGE_SITES_KEY, EDGE_HIDDEN_KEY],
      );
    });
    await this.#ports.changed();
    return this.status();
  }
  async matches() {
    await this.prune();
    return (await this.allEnabled())
      ? [...EDGE_ALL_HOSTS]
      : (await this.origins()).map((origin) => `${origin}/*`);
  }
  async allowed(origin: string) {
    return (
      edgeOrigin(origin) === origin &&
      !(await this.hidden()).includes(origin) &&
      ((await this.allEnabled()) || (await this.origins()).includes(origin)) &&
      (await this.#ports.permitted(origin))
    );
  }
  async status() {
    const tab = await this.#ports.current();
    const origin = tab && edgeOrigin(tab.origin);
    return {
      allSites: await this.allEnabled(),
      origin: origin || null,
      enabled: !!origin && (await this.allowed(origin)),
    };
  }
  async configure(enabled: boolean) {
    const tab = await this.#ports.current();
    const origin = tab && edgeOrigin(tab.origin);
    if (!origin || (enabled && !(await this.#ports.permitted(origin))))
      throw new BoundaryError('FORBIDDEN');
    // With all sites on, this switch only hides or shows the logo here.
    if (await this.allEnabled()) {
      await this.#setHidden(origin, !enabled);
      await this.#ports.changed();
      return this.status();
    }
    if (enabled) await this.#setHidden(origin, false);
    await this.#storage.run(async ({ local }) => {
      const parsed = Saved.safeParse(
        (await local.get(EDGE_SITES_KEY))[EDGE_SITES_KEY],
      );
      const origins = (parsed.success ? parsed.data.origins : []).filter(
        (v) => v !== origin,
      );
      if (enabled) origins.push(origin);
      if (origins.length > 64) throw new BoundaryError('BUSY');
      await local.set({ [EDGE_SITES_KEY]: { schemaVersion: 1, origins } });
    });
    await this.#ports.changed();
    return this.status();
  }
  async prune() {
    const allSaved = await this.#storage.run(
      async ({ local }) =>
        (await local.get(EDGE_ALL_KEY))[EDGE_ALL_KEY] === true,
    );
    if (allSaved && !(await this.#ports.allPermitted?.())) {
      await this.#storage.run(({ local }) =>
        local.remove([EDGE_ALL_KEY, EDGE_SITES_KEY]),
      );
    }
    const origins = await this.origins();
    const allowed: string[] = [];
    for (const origin of origins)
      if (await this.#ports.permitted(origin)) allowed.push(origin);
    if (allowed.length !== origins.length)
      await this.#storage.run(({ local }) =>
        local.set({ [EDGE_SITES_KEY]: { schemaVersion: 1, origins: allowed } }),
      );
    return allowed;
  }
  async activate(tabId: number, documentId: string, origin: string) {
    if (!(await this.allowed(origin))) throw new BoundaryError('FORBIDDEN');
    const key = `${tabId}:${documentId}`;
    if (Date.now() - (this.#recent.get(key) ?? 0) < 1500)
      throw new BoundaryError('BUSY');
    if (this.#recent.size >= 128)
      this.#recent.delete(this.#recent.keys().next().value!);
    this.#recent.set(key, Date.now());
    await this.#ports.activate(tabId, documentId, () => this.allowed(origin));
  }
  async clear() {
    await this.#storage.run(({ local }) =>
      local.remove([EDGE_SITES_KEY, EDGE_ALL_KEY, EDGE_HIDDEN_KEY]),
    );
    await this.#ports.changed();
  }
}
