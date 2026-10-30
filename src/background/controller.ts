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
import type { PlaybackHandler } from '../messaging/playback.ts';
import { GoogleCoordinator, type GooglePorts } from './google.ts';
import { TranslationFailure } from '../translation/contracts.ts';

export function createController(
  extensionId: string,
  areas: StorageAreas,
  playback?: PlaybackHandler,
  googlePorts: GooglePorts = { permitted: async () => false },
) {
  const storage = new TrustedStorage(areas);
  const settings = new SettingsStore(storage);
  const credentials = new CredentialStore(storage);
  const google = new GoogleCoordinator(storage, googlePorts);
  const sessions = new SessionRegistry(extensionId, Date.now, (tabId) =>
    google.cancelTab(tabId),
  );
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
      if (
        request.type === 'playback.enable' ||
        request.type === 'playback.disable' ||
        request.type === 'playback.status'
      ) {
        if (sender.kind !== 'ui' || sender.page !== 'popup')
          throw new BoundaryError('FORBIDDEN');
        if (!playback) throw new BoundaryError('UNAVAILABLE');
        response = {
          ok: true,
          data: {
            kind: 'playback',
            state: await playback(
              request.type,
              request.type === 'playback.enable' &&
                request.youtubeSourceConfirmed,
            ),
          },
        };
      } else if (
        request.type === 'content.translate' ||
        request.type === 'content.cancel'
      ) {
        if (sender.kind !== 'content') throw new BoundaryError('FORBIDDEN');
        const valid = () =>
          sessions.assertBound(request.sessionId, sender.identity);
        valid();
        if (request.type === 'content.cancel') {
          google.cancel(request.sessionId, request.jobId);
          response = { ok: true, data: { kind: 'saved' } };
        } else {
          const preferences = await settings.read();
          valid();
          try {
            const result = await google.translate(
              sender.identity.tabId,
              request.sessionId,
              request.job,
              preferences,
              valid,
            );
            valid();
            response = {
              ok: true,
              data: { kind: 'translation', result: { ok: true, ...result } },
            };
          } catch (error) {
            if (!(error instanceof TranslationFailure)) throw error;
            response = {
              ok: true,
              data: {
                kind: 'translation',
                result: { ok: false, error: error.code },
              },
            };
          }
        }
      } else if (
        request.type === 'google.status' ||
        request.type === 'google.enable' ||
        request.type === 'google.disable'
      ) {
        if (sender.kind !== 'ui' || sender.page !== 'options')
          throw new BoundaryError('FORBIDDEN');
        const enabled =
          request.type === 'google.status'
            ? await google.enabled()
            : await google.setEnabled(request.type === 'google.enable');
        response = { ok: true, data: { kind: 'google-status', enabled } };
      } else if (request.type === 'content.settings') {
        if (sender.kind !== 'content') throw new BoundaryError('FORBIDDEN');
        sessions.assertBound(request.sessionId, sender.identity);
        const preferences = await settings.read();
        const googleEnabled = await google.enabled();
        sessions.assertBound(request.sessionId, sender.identity);
        response = {
          ok: true,
          data: { kind: 'settings', settings: preferences, googleEnabled },
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
            google.cancelAll();
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
  return { dispatch, sessions, google };
}
