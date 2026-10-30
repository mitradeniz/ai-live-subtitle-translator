import { AIProfileSchema, aiDefinition } from '../translation/ai-profile.ts';
import { PaidCoordinator, type PaidPorts } from './paid.ts';
import { ProviderSelection } from './provider-selection.ts';
import { DEFAULT_SETTINGS } from '../messaging/protocol.ts';
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
  aiPorts: PaidPorts = { permitted: async () => false },
  cloudPorts: PaidPorts = { permitted: async () => false },
) {
  const storage = new TrustedStorage(areas);
  const settings = new SettingsStore(storage);
  const credentials = new CredentialStore(storage);
  const google = new GoogleCoordinator(storage, googlePorts);
  const ai = new PaidCoordinator(storage, credentials, aiPorts);
  const cloud = new PaidCoordinator(
    storage,
    credentials,
    cloudPorts,
    'google-cloud',
  );
  const selection = new ProviderSelection(storage);
  let epoch = 0;
  const cancelAll = () => {
    epoch++;
    google.cancelAll();
    ai.cancelAll();
    cloud.cancelAll();
    sessions.revokeAll();
  };
  const sessions = new SessionRegistry(extensionId, Date.now, (tabId) => {
    google.cancelTab(tabId);
    ai.cancelTab(tabId);
    cloud.cancelTab(tabId);
  });
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
        const ticket = epoch;
        const valid = () => {
          sessions.assertBound(request.sessionId, sender.identity);
          if (ticket !== epoch) throw new TranslationFailure('CANCELLED');
        };
        valid();
        if (request.type === 'content.cancel') {
          google.cancel(request.sessionId, request.jobId);
          ai.cancel(request.sessionId, request.jobId);
          cloud.cancel(request.sessionId, request.jobId);
          response = { ok: true, data: { kind: 'saved' } };
        } else {
          const preferences = await settings.read();
          try {
            valid();
            const selected = await selection.read();
            valid();
            if (selected === 'none') throw new TranslationFailure('OFF');
            const result = await (
              selected === 'ai'
                ? ai
                : selected === 'google-cloud'
                  ? cloud
                  : google
            ).translate(
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
      } else if (request.type === 'provider.status') {
        if (sender.kind !== 'ui' || sender.page !== 'options')
          throw new BoundaryError('FORBIDDEN');
        response = {
          ok: true,
          data: {
            kind: 'provider-status',
            selected:
              (await selection.read()) === 'google' && !(await google.enabled())
                ? 'none'
                : await selection.read(),
          },
        };
      } else if (
        request.type === 'cloud.status' ||
        request.type === 'cloud.enable' ||
        request.type === 'cloud.disable' ||
        request.type === 'cloud.test'
      ) {
        if (sender.kind !== 'ui' || sender.page !== 'options')
          throw new BoundaryError('FORBIDDEN');
        if (request.type === 'cloud.test') {
          const ticket = epoch;
          try {
            await cloud.translate(
              -1,
              'options-cloud-test',
              {
                jobId: crypto.randomUUID(),
                generation: 0,
                items: [{ id: 'test', revision: 0, text: 'Hello, world.' }],
              },
              {
                ...DEFAULT_SETTINGS,
                sourceLanguage: 'en',
                targetLanguage: 'tr',
              },
              () => {
                if (ticket !== epoch) throw new TranslationFailure('CANCELLED');
              },
            );
            response = {
              ok: true,
              data: { kind: 'cloud-test', success: true },
            };
          } catch (error) {
            if (!(error instanceof TranslationFailure)) throw error;
            response = {
              ok: true,
              data: { kind: 'cloud-test', success: false, error: error.code },
            };
          }
        } else {
          if (request.type !== 'cloud.status') cancelAll();
          const ticket = epoch;
          if (request.type === 'cloud.enable') {
            if (!(await cloud.permitted()))
              throw new BoundaryError('UNAVAILABLE');
            await selection.set('google-cloud', () => ticket === epoch);
          }
          if (request.type === 'cloud.disable')
            await selection.disable('google-cloud');
          if (request.type !== 'cloud.status' && ticket === epoch) cancelAll();
          response = {
            ok: true,
            data: {
              kind: 'cloud-status',
              enabled: (await selection.read()) === 'google-cloud',
              permitted: await cloud.permitted(),
              status: await credentials.status('google-cloud'),
            },
          };
        }
      } else if (
        request.type === 'ai.status' ||
        request.type === 'ai.configure' ||
        request.type === 'ai.enable' ||
        request.type === 'ai.disable' ||
        request.type === 'ai.test'
      ) {
        if (sender.kind !== 'ui' || sender.page !== 'options')
          throw new BoundaryError('FORBIDDEN');
        if (request.type === 'ai.test') {
          const ticket = epoch;
          try {
            await ai.translate(
              -1,
              'options-test',
              {
                jobId: crypto.randomUUID(),
                generation: 0,
                items: [{ id: 'test', revision: 0, text: 'Hello, world.' }],
              },
              {
                ...DEFAULT_SETTINGS,
                sourceLanguage: 'en',
                targetLanguage: 'tr',
              },
              () => {
                if (ticket !== epoch) throw new TranslationFailure('CANCELLED');
              },
            );
            response = { ok: true, data: { kind: 'ai-test', success: true } };
          } catch (error) {
            if (!(error instanceof TranslationFailure)) throw error;
            response = {
              ok: true,
              data: { kind: 'ai-test', success: false, error: error.code },
            };
          }
        } else {
          if (request.type !== 'ai.status') cancelAll();
          const ticket = epoch;
          if (request.type === 'ai.configure')
            await ai.configure(request.profile);
          if (request.type === 'ai.enable') {
            if (!(await ai.permitted())) throw new BoundaryError('UNAVAILABLE');
            await selection.set('ai', () => ticket === epoch);
          }
          if (request.type === 'ai.disable') await selection.disable('ai');
          if (request.type !== 'ai.status' && ticket === epoch) cancelAll();
          response = {
            ok: true,
            data: {
              kind: 'ai-status',
              profile: AIProfileSchema.parse(await ai.profile()),
              enabled: (await selection.read()) === 'ai',
              permitted: await ai.permitted(),
              status: await credentials.status('ai'),
            },
          };
        }
      } else if (
        request.type === 'google.status' ||
        request.type === 'google.enable' ||
        request.type === 'google.disable'
      ) {
        if (sender.kind !== 'ui' || sender.page !== 'options')
          throw new BoundaryError('FORBIDDEN');
        if (request.type !== 'google.status') cancelAll();
        const ticket = epoch;
        const consent =
          request.type === 'google.status'
            ? await google.enabled()
            : await google.setEnabled(request.type === 'google.enable');
        if (request.type === 'google.enable' && consent)
          await selection.set('google', () => ticket === epoch);
        if (request.type === 'google.disable')
          await selection.disable('google');
        if (request.type !== 'google.status' && ticket === epoch) cancelAll();
        const enabled = consent && (await selection.read()) === 'google';
        response = { ok: true, data: { kind: 'google-status', enabled } };
      } else if (request.type === 'content.settings') {
        if (sender.kind !== 'content') throw new BoundaryError('FORBIDDEN');
        sessions.assertBound(request.sessionId, sender.identity);
        const preferences = await settings.read();
        const selected = await selection.read();
        const googleEnabled = selected === 'google' && (await google.enabled());
        const aiEnabled = selected === 'ai';
        const cloudEnabled = selected === 'google-cloud';
        const aiProfile = aiEnabled
          ? AIProfileSchema.parse(await ai.profile())
          : null;
        const providerLabel = aiProfile
          ? `${aiDefinition(aiProfile).name} · User API · Captions sent to ${new URL(aiProfile.endpoint).hostname}`
          : cloudEnabled
            ? 'Google Cloud · Paid API · Captions sent to translation.googleapis.com'
            : googleEnabled
              ? 'Google · Experimental · Captions sent to Google'
              : '';
        sessions.assertBound(request.sessionId, sender.identity);
        response = {
          ok: true,
          data: {
            kind: 'settings',
            settings: preferences,
            googleEnabled,
            aiEnabled,
            cloudEnabled,
            providerLabel,
          },
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
            cancelAll();
            response = {
              ok: true,
              data: {
                kind: 'settings',
                settings: await settings.update(request.preferences),
              },
            };
            cancelAll();
            break;
          case 'settings.export':
            response = {
              ok: true,
              data: { kind: 'export', exported: await settings.export() },
            };
            break;
          case 'credentials.set':
            cancelAll();
            await credentials.set(
              request.credentialId,
              request.credential,
              request.rememberOnDevice,
            );
            await (request.credentialId === 'ai' ? ai : cloud).keyChanged();
            cancelAll();
            response = { ok: true, data: { kind: 'saved' } };
            break;
          case 'credentials.delete':
            cancelAll();
            await credentials.delete(request.credentialId);
            cancelAll();
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
  return { dispatch, sessions, google, ai, cloud, selection, cancelAll };
}
