import {
  CredentialIdSchema,
  CredentialRecordSchema,
  OriginSchema,
  type CredentialId,
} from '../messaging/protocol.ts';
import { BoundaryError } from './errors.ts';
import type { StorageAreas, TrustedStorage } from './storage.ts';

export class CredentialStore {
  readonly #storage: TrustedStorage;
  constructor(storage: TrustedStorage) {
    this.#storage = storage;
  }

  #key(id: CredentialId): string {
    if (!CredentialIdSchema.safeParse(id).success)
      throw new BoundaryError('INVALID_MESSAGE');
    return `credential.v1.${id}`;
  }

  async #remove(areas: StorageAreas, key: string): Promise<void> {
    await areas.local.remove(key);
    await areas.session.remove(key);
  }

  async #read(areas: StorageAreas, key: string) {
    const temporary = (await areas.session.get(key))[key];
    const durable = (await areas.local.get(key))[key];
    if (temporary === undefined && durable === undefined) return null;
    const record = CredentialRecordSchema.safeParse(temporary ?? durable);
    if (!record.success || (temporary !== undefined && durable !== undefined)) {
      await this.#remove(areas, key);
      return null;
    }
    return {
      record: record.data,
      retention:
        temporary !== undefined ? ('session' as const) : ('device' as const),
    };
  }

  set(id: CredentialId, raw: unknown, rememberOnDevice = false): Promise<void> {
    const key = this.#key(id);
    const parsed = CredentialRecordSchema.safeParse(raw);
    if (!parsed.success || typeof rememberOnDevice !== 'boolean')
      throw new BoundaryError('INVALID_MESSAGE');
    return this.#storage.run(async (areas) => {
      // Delete old retention copies before writing; never fall back to an older key.
      await this.#remove(areas, key);
      await areas[rememberOnDevice ? 'local' : 'session'].set({
        [key]: parsed.data,
      });
    });
  }

  delete(id: CredentialId): Promise<void> {
    const key = this.#key(id);
    return this.#storage.run((areas) => this.#remove(areas, key));
  }

  status(id: CredentialId, origin?: string) {
    const key = this.#key(id);
    return this.#storage.run(async (areas) => {
      const item = await this.#read(areas, key);
      const matches =
        item !== null && (!origin || item.record.origin === origin);
      return {
        configured: matches,
        retention: matches ? item.retention : null,
      };
    });
  }

  // Background-only provider hook: deliberately absent from the runtime protocol.
  readForOrigin(
    id: CredentialId,
    origin: string,
    current = () => true,
  ): Promise<string | null> {
    const key = this.#key(id);
    if (!OriginSchema.safeParse(origin).success)
      throw new BoundaryError('INVALID_MESSAGE');
    return this.#storage.run(async (areas) => {
      if (!current()) return null;
      const item = await this.#read(areas, key);
      if (!current()) return null;
      if (!item) return null;
      if (item.record.origin !== origin) {
        await this.#remove(areas, key);
        return null;
      }
      return item.record.key;
    });
  }
}
