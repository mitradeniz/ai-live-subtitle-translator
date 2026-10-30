import {
  DEFAULT_SETTINGS,
  PreferencesSchema,
  SettingsSchema,
  type Settings,
} from '../messaging/protocol.ts';
import { BoundaryError } from './errors.ts';
import type { TrustedStorage } from './storage.ts';

export const SETTINGS_KEY = 'settings.v1';

export class SettingsStore {
  readonly #storage: TrustedStorage;
  constructor(storage: TrustedStorage) {
    this.#storage = storage;
  }

  read(): Promise<Settings> {
    return this.#storage.run(async ({ local }) => {
      const raw = (await local.get(SETTINGS_KEY))[SETTINGS_KEY];
      const parsed = SettingsSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      if (
        raw &&
        typeof raw === 'object' &&
        'schemaVersion' in raw &&
        typeof raw.schemaVersion === 'number' &&
        raw.schemaVersion > 1
      ) {
        throw new BoundaryError('UNSUPPORTED_SETTINGS_VERSION');
      }
      const defaults = { ...DEFAULT_SETTINGS };
      await local.set({ [SETTINGS_KEY]: defaults });
      return defaults;
    });
  }

  update(preferences: unknown): Promise<Settings> {
    const parsed = PreferencesSchema.safeParse(preferences);
    if (!parsed.success) throw new BoundaryError('INVALID_MESSAGE');
    return this.#storage.run(async ({ local }) => {
      const current = (await local.get(SETTINGS_KEY))[SETTINGS_KEY];
      if (
        current &&
        typeof current === 'object' &&
        'schemaVersion' in current &&
        typeof current.schemaVersion === 'number' &&
        current.schemaVersion > 1
      ) {
        throw new BoundaryError('UNSUPPORTED_SETTINGS_VERSION');
      }
      const settings: Settings = { schemaVersion: 1, ...parsed.data };
      await local.set({ [SETTINGS_KEY]: settings });
      return settings;
    });
  }

  async export() {
    return {
      format: 'subtitle-translator-settings' as const,
      schemaVersion: 1 as const,
      settings: await this.read(),
    };
  }
}
