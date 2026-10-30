import { BoundaryError } from './errors.ts';

export interface StorageArea {
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
export type StorageAreas = { local: StorageArea; session: StorageArea };

export class TrustedStorage {
  readonly #areas: StorageAreas;
  readonly #ready: Promise<void>;
  #failed = false;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(areas: StorageAreas) {
    this.#areas = areas;
    this.#ready = this.#initialize();
  }

  async #initialize(): Promise<void> {
    // No get/set/remove may run before both areas have been restricted.
    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        this.#areas.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
      ),
      Promise.resolve().then(() =>
        this.#areas.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
      ),
    ]);
    this.#failed = results.some((result) => result.status === 'rejected');
  }

  async run<T>(operation: (areas: StorageAreas) => Promise<T>): Promise<T> {
    await this.#ready;
    const result = this.#tail.then(async () => {
      if (this.#failed) throw new BoundaryError('UNAVAILABLE');
      try {
        return await operation(this.#areas);
      } catch (error) {
        if (error instanceof BoundaryError) throw error;
        // Storage failures latch closed for this worker lifetime; never expose raw errors.
        this.#failed = true;
        throw new BoundaryError('UNAVAILABLE');
      }
    });
    this.#tail = result.catch(() => undefined);
    return result;
  }
}
