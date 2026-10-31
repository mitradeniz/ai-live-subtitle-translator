import {
  DEFAULT_PAGE_PREFERENCES,
  PagePreferencesSchema,
} from '../page/contracts.ts';
import type { TrustedStorage } from './storage.ts';
export const PAGE_PREFERENCES_KEY = 'page-preferences.v1';
export class PageSettings {
  private storage: TrustedStorage;
  constructor(storage: TrustedStorage) {
    this.storage = storage;
  }
  async read() {
    return this.storage.run(async ({ local }) => {
      const result = PagePreferencesSchema.safeParse(
        (await local.get(PAGE_PREFERENCES_KEY))[PAGE_PREFERENCES_KEY],
      );
      return result.success ? result.data : { ...DEFAULT_PAGE_PREFERENCES };
    });
  }
  async update(value: unknown) {
    const preferences = PagePreferencesSchema.parse(value);
    await this.storage.run(({ local }) =>
      local.set({ [PAGE_PREFERENCES_KEY]: preferences }),
    );
    return preferences;
  }
}
