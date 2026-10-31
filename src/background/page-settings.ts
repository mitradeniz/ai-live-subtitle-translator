import { BoundaryError } from './errors.ts';
import {
  DEFAULT_PAGE_PREFERENCES,
  PagePreferencesSchema,
  type PagePreferences,
} from '../page/contracts.ts';
import type { StorageArea, TrustedStorage } from './storage.ts';
export const PAGE_PREFERENCES_KEY = 'page-preferences.v2';
// Version 1 started pages in bilingual display and asked to confirm the
// YouTube caption track every time. Version 2 starts pages translation-only
// and treats the selected track as confirmed, so version 1 preferences move to
// those defaults once. Both remain adjustable in Customize translation.
export const LEGACY_PAGE_PREFERENCES_KEY = 'page-preferences.v1';
async function load(local: StorageArea): Promise<PagePreferences> {
  const current = PagePreferencesSchema.safeParse(
    (await local.get(PAGE_PREFERENCES_KEY))[PAGE_PREFERENCES_KEY],
  );
  if (current.success) return current.data;
  const legacy = PagePreferencesSchema.safeParse(
    (await local.get(LEGACY_PAGE_PREFERENCES_KEY))[LEGACY_PAGE_PREFERENCES_KEY],
  );
  if (legacy.success)
    return {
      ...legacy.data,
      display: 'translated',
      youtubeSourceConfirmed: true,
    };
  return { ...DEFAULT_PAGE_PREFERENCES };
}
async function save(local: StorageArea, preferences: PagePreferences) {
  await local.set({ [PAGE_PREFERENCES_KEY]: preferences });
  await local.remove(LEGACY_PAGE_PREFERENCES_KEY);
}
export class PageSettings {
  private storage: TrustedStorage;
  constructor(storage: TrustedStorage) {
    this.storage = storage;
  }
  async read() {
    return this.storage.run(({ local }) => load(local));
  }
  async action(action: 'page' | 'captions', valid: () => void) {
    return this.storage.run(async ({ local }) => {
      const preferences = await load(local);
      valid();
      if (!preferences[action]) throw new BoundaryError('FORBIDDEN');
      preferences.clickAction = action;
      await save(local, preferences);
      return preferences;
    });
  }
  async update(value: unknown) {
    const preferences = PagePreferencesSchema.parse(value);
    await this.storage.run(({ local }) => save(local, preferences));
    return preferences;
  }
}
