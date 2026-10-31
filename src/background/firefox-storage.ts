import type { StorageArea, StorageAreas } from './storage.ts';

// Firefox has no storage.local.setAccessLevel. All authoritative durable state
// therefore lives at the extension's own IndexedDB origin, not storage.local.
// A content script's IndexedDB belongs to its webpage. Never expose a DB proxy
// through runtime messages. Firefox storage.session is trusted-only by default.
export function firefoxStorage(
  session: Omit<StorageArea, 'setAccessLevel'>,
  notify: () => Promise<void>,
  factory: IDBFactory = indexedDB,
): StorageAreas {
  let database: Promise<IDBDatabase> | undefined;
  const open = () => {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('subtitle-trusted-state', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('records');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(new Error('Trusted storage unavailable'));
      request.onblocked = () =>
        reject(new Error('Trusted storage unavailable'));
    });
    return database;
  };
  async function transact<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T> | undefined,
  ): Promise<T | undefined> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', mode);
      const request = operation(transaction.objectStore('records'));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onabort = transaction.onerror = () =>
        reject(new Error('Trusted storage unavailable'));
    });
  }
  const changed = () => {
    void notify().catch(() => {});
  };
  return {
    local: {
      // Initialize the private database before TrustedStorage permits operations.
      setAccessLevel: async () => {
        await open();
      },
      get: async (key) => ({
        [key]: await transact('readonly', (store) => store.get(key)),
      }),
      set: async (items) => {
        // Match storage.onChanged: identical writes must not create a UI
        // refresh -> status read -> identical write notification loop.
        const entries = Object.entries(items);
        const differences = await Promise.all(
          entries.map(
            async ([key, value]) =>
              JSON.stringify(
                await transact('readonly', (store) => store.get(key)),
              ) !== JSON.stringify(value),
          ),
        );
        if (!differences.some(Boolean)) return;
        await transact('readwrite', (store) => {
          for (const [key, value] of entries) store.put(value, key);
          return undefined;
        });
        changed();
      },
      remove: async (keys) => {
        const list = typeof keys === 'string' ? [keys] : keys;
        const existing = await Promise.all(
          list.map((key) => transact('readonly', (store) => store.get(key))),
        );
        if (existing.every((value) => value === undefined)) return;
        await transact('readwrite', (store) => {
          for (const key of list) store.delete(key);
          return undefined;
        });
        changed();
      },
    },
    session: {
      // This adapter is selected only in Firefox builds. There is no Firefox API
      // that can expose storage.session to content scripts; absence is fatal.
      setAccessLevel: async () => {
        if (!session?.get || !session.set || !session.remove)
          throw new Error('Trusted session storage unavailable');
      },
      get: (key) => session.get(key),
      // Firefox already emits native session-storage events to trusted UI.
      set: (items) => session.set(items),
      remove: (keys) => session.remove(keys),
    },
  };
}
