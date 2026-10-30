import {
  RequestSchema,
  ResponseSchema,
  withinMessageBudget,
  type Response,
} from '../messaging/protocol.ts';
import { CredentialStore } from './credentials.ts';
import { BoundaryError } from './errors.ts';
import { identifySender } from './senders.ts';
import { SessionRegistry } from './sessions.ts';
import { SettingsStore } from './settings.ts';
import { TrustedStorage, type StorageAreas } from './storage.ts';

export function createController(extensionId: string, areas: StorageAreas) {
  const storage = new TrustedStorage(areas);
  const settings = new SettingsStore(storage);
  const credentials = new CredentialStore(storage);
  const sessions = new SessionRegistry(extensionId);
  let pending = 0;

  async function dispatch(
    raw: unknown,
    browserSender: unknown,
  ): Promise<Response> {
    if (pending >= 32) return { ok: false, error: 'BUSY' };
    pending++;
    try {
      if (!withinMessageBudget(raw)) throw new BoundaryError('INVALID_MESSAGE');
      const parsed = RequestSchema.safeParse(raw);
      if (!parsed.success) throw new BoundaryError('INVALID_MESSAGE');
      const request = parsed.data;
      const sender = identifySender(browserSender, extensionId);
      let response: Response;
      if (request.type === 'content.settings') {
        if (sender.kind !== 'content') throw new BoundaryError('FORBIDDEN');
        sessions.assertBound(request.sessionId, sender.identity);
        const preferences = await settings.read();
        sessions.assertBound(request.sessionId, sender.identity);
        response = {
          ok: true,
          data: { kind: 'settings', settings: preferences },
        };
      } else {
        if (sender.kind !== 'ui') throw new BoundaryError('FORBIDDEN');
        if (sender.page !== 'options' && request.type !== 'settings.read')
          throw new BoundaryError('FORBIDDEN');
        switch (request.type) {
          case 'settings.read':
            response = {
              ok: true,
              data: { kind: 'settings', settings: await settings.read() },
            };
            break;
          case 'settings.update':
            response = {
              ok: true,
              data: {
                kind: 'settings',
                settings: await settings.update(request.preferences),
              },
            };
            break;
          case 'settings.export':
            response = {
              ok: true,
              data: { kind: 'export', exported: await settings.export() },
            };
            break;
          case 'credentials.set':
            await credentials.set(
              request.credentialId,
              request.credential,
              request.rememberOnDevice,
            );
            response = { ok: true, data: { kind: 'saved' } };
            break;
          case 'credentials.delete':
            await credentials.delete(request.credentialId);
            response = { ok: true, data: { kind: 'deleted' } };
            break;
          case 'credentials.status':
            response = {
              ok: true,
              data: {
                kind: 'credential-status',
                status: await credentials.status(request.credentialId),
              },
            };
            break;
        }
      }
      return ResponseSchema.parse(response);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof BoundaryError ? error.code : 'UNAVAILABLE',
      };
    } finally {
      pending--;
    }
  }
  return { dispatch, sessions };
}
