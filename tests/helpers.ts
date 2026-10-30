import type { StorageArea } from '../src/background/storage.ts';

export const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
export const DOCUMENT_ID = '00000000-0000-4000-8000-000000000001';
export const uiSender = (page = 'options') => ({
  id: EXTENSION_ID,
  url: `chrome-extension://${EXTENSION_ID}/${page}.html`,
  origin: `chrome-extension://${EXTENSION_ID}`,
  documentId: DOCUMENT_ID,
  documentLifecycle: 'active',
});
export const contentSender = () => ({
  id: EXTENSION_ID,
  url: 'https://video.example.test/watch',
  origin: 'https://video.example.test',
  documentId: DOCUMENT_ID,
  documentLifecycle: 'active',
  tab: { id: 7, incognito: false },
  frameId: 0,
});
export const request = (type: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  requestId: 'test-request',
  type,
  ...extra,
});
export const SENTINEL = 'SENTINEL_NOT_A_REAL_KEY';
export const credential = {
  schemaVersion: 1 as const,
  origin: 'https://provider.example.test',
  key: SENTINEL,
};

export class FakeArea implements StorageArea {
  data: Record<string, unknown> = {};
  calls: string[] = [];
  access: string | null = null;
  failAccess = false;
  failWrite = false;
  accessBarrier: Promise<void> = Promise.resolve();
  async setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }) {
    this.calls.push('restrict');
    await this.accessBarrier;
    if (this.failAccess) throw new Error(SENTINEL);
    this.access = options.accessLevel;
  }
  async get(key: string) {
    this.calls.push('get');
    return structuredClone({ [key]: this.data[key] });
  }
  async set(items: Record<string, unknown>) {
    this.calls.push('set');
    if (this.failWrite) throw new Error(SENTINEL);
    Object.assign(this.data, structuredClone(items));
  }
  async remove(keys: string | string[]) {
    this.calls.push('remove');
    for (const key of typeof keys === 'string' ? [keys] : keys)
      delete this.data[key];
  }
}
export const fakeAreas = () => ({
  local: new FakeArea(),
  session: new FakeArea(),
});
