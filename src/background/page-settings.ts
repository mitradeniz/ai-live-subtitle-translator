import { BoundaryError } from './errors.ts';
import {
  DEFAULT_PAGE_PREFERENCES,
  PagePreferencesSchema,
  type PagePreferences,
} from '../page/contracts.ts';
import type { StorageArea, TrustedStorage } from './storage.ts';
export const PAGE_PREFERENCES_KEY = 'page-preferences.v3';
// Earlier versions started pages bilingual, asked to confirm the YouTube caption
// track every time and kept selected-text translation off. Version 3 starts
// pages translation-only, treats the selected track as confirmed and shows the
// small selection marker (it sends nothing until clicked). Earlier preferences
// move to these defaults once; all stay adjustable in Customize translation.
export const LEGACY_PAGE_PREFERENCES_KEYS = [
  'page-preferences.v2',
  'page-preferences.v1',
] as const;
async function load(local: StorageArea): Promise<PagePreferences> {
  const current = PagePreferencesSchema.safeParse(
    (await local.get(PAGE_PREFERENCES_KEY))[PAGE_PREFERENCES_KEY],
  );
  if (current.success) return current.data;
  for (const key of LEGACY_PAGE_PREFERENCES_KEYS) {
    const legacy = PagePreferencesSchema.safeParse((await local.get(key))[key]);
    if (legacy.success)
      return {
        ...legacy.data,
        display: 'translated',
        youtubeSourceConfirmed: true,
        selection: true,
        autoSelection: false,
      };
  }
  return { ...DEFAULT_PAGE_PREFERENCES };
}
async function save(local: StorageArea, preferences: PagePreferences) {
  await local.set({ [PAGE_PREFERENCES_KEY]: preferences });
  await local.remove([...LEGACY_PAGE_PREFERENCES_KEYS]);
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
