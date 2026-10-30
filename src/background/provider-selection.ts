import { z } from '../messaging/schema.ts';
import type { TrustedStorage } from './storage.ts';

const KEY = 'translation-provider.v1';
const Schema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.enum(['google', 'google-cloud', 'ai', 'none']),
});
export class ProviderSelection {
  #storage: TrustedStorage;
  constructor(storage: TrustedStorage) {
    this.#storage = storage;
  }
  read() {
    return this.#storage.run(async ({ local }) => {
      const raw = (await local.get(KEY))[KEY];
      // Upgrade preserves existing Google consent; malformed selection fails closed.
      if (raw === undefined) return 'google' as const;
      const parsed = Schema.safeParse(raw);
      return parsed.success ? parsed.data.provider : ('none' as const);
    });
  }
  set(
    provider: 'google' | 'google-cloud' | 'ai' | 'none',
    current = () => true,
  ) {
    return this.#storage.run(async ({ local }) => {
      if (current()) await local.set({ [KEY]: { schemaVersion: 1, provider } });
    });
  }
  disable(provider: 'google' | 'google-cloud' | 'ai') {
    return this.#storage.run(async ({ local }) => {
      const raw = (await local.get(KEY))[KEY];
      const parsed = Schema.safeParse(raw);
      if (
        (raw === undefined && provider === 'google') ||
        (parsed.success && parsed.data.provider === provider)
      )
        await local.set({ [KEY]: { schemaVersion: 1, provider: 'none' } });
    });
  }
}
