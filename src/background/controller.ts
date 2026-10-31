import { SitePreferences, YOUTUBE_ORIGIN, type SitePorts } from './sites.ts';
import { isYouTubeWatch } from '../youtube/source.ts';
import { WorkQueue } from './work-queue.ts';
import { CLOUD_PROFILE } from '../translation/google-cloud.ts';
import { AIProfileSchema, aiDefinition } from '../translation/ai-profile.ts';
import { PaidCoordinator, type PaidPorts } from './paid.ts';
import { ProviderSelection } from './provider-selection.ts';
import { DEFAULT_SETTINGS } from '../messaging/protocol.ts';
import {
  RequestSchema,
  ResponseSchema,
  withinMessageBudget,
  type Response,
  type PopupStatus,
} from '../messaging/protocol.ts';
import { CredentialStore } from './credentials.ts';
import { BoundaryError } from './errors.ts';
import { identifySender } from './senders.ts';
import { SessionRegistry } from './sessions.ts';
import { SettingsStore } from './settings.ts';
import { TrustedStorage, type StorageAreas } from './storage.ts';
import type { PlaybackHandler } from '../messaging/playback.ts';
import { GoogleCoordinator, type GooglePorts } from './google.ts';
import {
  TranslationFailure,
  type TranslationErrorCode,
} from '../translation/contracts.ts';

export function createController(
  extensionId: string,
  areas: StorageAreas,
  playback?: PlaybackHandler,
  googlePorts: GooglePorts = { permitted: async () => false },
  aiPorts: PaidPorts = { permitted: async () => false },
  cloudPorts: PaidPorts = { permitted: async () => false },
  sitePorts: SitePorts = {
    permitted: async () => false,
    changed: async () => {},
    activate: async () => {},
  },
  popupTab: () => Promise<{
    tabId: number;
    youtube: boolean;
  } | null> = async () => null,
  openSettings: () => Promise<void> = async () => {
    throw new BoundaryError('UNAVAILABLE');
  },
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
  const work = new WorkQueue(storage);
  const sites = new SitePreferences(storage, sitePorts);
  const selection = new ProviderSelection(storage);
  // No captions, URLs or provider error bodies. Ephemeral and bounded per tab.
  const recent = new Map<number, NonNullable<PopupStatus['recent']>>();
  function record(tabId: number, value: NonNullable<PopupStatus['recent']>) {
    recent.delete(tabId);
    if (recent.size >= 32) recent.delete(recent.keys().next().value!);
    recent.set(tabId, value);
  }
  let epoch = 0;
  const cancelAll = () => {
    epoch++;
    recent.clear();
    work.cancel();
    google.cancelAll();
    ai.cancelAll();
    cloud.cancelAll();
    sessions.revokeAll();
  };
  const sessions = new SessionRegistry(
    extensionId,
    Date.now,
    (tabId) => {
      recent.delete(tabId);
      google.cancelTab(tabId);
      ai.cancelTab(tabId);
      cloud.cancelTab(tabId);
      work.cancel(undefined, undefined, tabId);
    },
    storage,
  );
  let pending = 0;
  const settingsOpened = new Map<number, number>();

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
      await sessions.flush();
      let response: Response;
      if (
        request.type === 'playback.enable' ||
        request.type === 'playback.disable' ||
        request.type === 'playback.status'
      ) {
        if (sender.kind !== 'ui' || sender.page !== 'popup')
          throw new BoundaryError('FORBIDDEN');
        if (!playback) throw new BoundaryError('UNAVAILABLE');
        if (
          request.type === 'playback.enable' &&
          (await settings.read()).displayMode !== 'original'
        ) {
          const selected = await selection.read();
          if (selected === 'ai' || selected === 'google-cloud') {
            const paid = selected === 'ai' ? ai : cloud;
            const profile = await paid.profile();
            if (
              !(
                await credentials.status(
                  selected,
                  new URL(profile.endpoint).origin,
                )
              ).configured
            )
              return {
                ok: true,
                data: { kind: 'playback', state: 'key-required' },
              };
            if (!(await paid.permitted()))
              return {
                ok: true,
                data: { kind: 'playback', state: 'permission-required' },
              };
          }
        }
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
      } else if (request.type === 'popup.read') {
        if (sender.kind !== 'ui' || sender.page !== 'popup')
          throw new BoundaryError('FORBIDDEN');
        const profile = AIProfileSchema.parse(await ai.profile());
        const tab = await popupTab();
        const last = tab ? recent.get(tab.tabId) : undefined;
        const selected = await selection.read();
        response = {
          ok: true,
          data: {
            kind: 'popup-status',
            selected:
              selected === 'google' && !(await google.enabled())
                ? 'none'
                : selected,
            settings: await settings.read(),
            profile,
            ai: {
              ...(await credentials.status(
                'ai',
                new URL(profile.endpoint).origin,
              )),
              permitted: await ai.permitted(),
            },
            cloud: {
              ...(await credentials.status(
                'google-cloud',
                new URL(CLOUD_PROFILE.endpoint).origin,
              )),
              permitted: await cloud.permitted(),
            },
            googlePermitted: await googlePorts.permitted(),
            youtube: tab?.youtube ?? false,
            recent: last && Date.now() - last.at < 300_000 ? last : null,
          },
        };
      } else if (request.type === 'content.appearance') {
        if (sender.kind !== 'content') throw new BoundaryError('FORBIDDEN');
        sessions.assertBound(request.sessionId, sender.identity);
        const prior = await settings.read();
        sessions.assertBound(request.sessionId, sender.identity);
        if (prior.displayMode !== request.appearance.displayMode) {
          work.cancel();
          google.cancelAll();
          ai.cancelAll();
          cloud.cancelAll();
        }
        response = {
          ok: true,
          data: {
            kind: 'settings',
            settings: await settings.updateAppearance(request.appearance, () =>
              sessions.assertBound(request.sessionId, sender.identity),
            ),
          },
        };
      } else if (request.type === 'content.open-settings') {
        if (sender.kind !== 'content') throw new BoundaryError('FORBIDDEN');
        sessions.assertBound(request.sessionId, sender.identity);
        const tabId = sender.identity.tabId;
        if (Date.now() - (settingsOpened.get(tabId) ?? 0) < 5000)
          throw new BoundaryError('BUSY');
        if (settingsOpened.size >= 32)
          settingsOpened.delete(settingsOpened.keys().next().value!);
        settingsOpened.set(tabId, Date.now());
        await openSettings();
        response = { ok: true, data: { kind: 'saved' } };
      } else if (request.type === 'content.stop') {
        if (sender.kind !== 'content') throw new BoundaryError('FORBIDDEN');
        sessions.assertBound(request.sessionId, sender.identity);
        await sites.pause(sender.identity.tabId);
        sessions.revokeTab(sender.identity.tabId);
        response = { ok: true, data: { kind: 'saved' } };
      } else if (request.type === 'site.activate') {
        if (
          sender.kind !== 'content' ||
          sender.identity.origin !== YOUTUBE_ORIGIN ||
          sender.identity.frameId !== 0 ||
          !isYouTubeWatch((browserSender as { url: string }).url)
        )
          throw new BoundaryError('FORBIDDEN');
        await sites.activate(sender.identity.tabId, sender.identity.documentId);
        response = { ok: true, data: { kind: 'saved' } };
      } else if (
        request.type === 'site.status' ||
        request.type === 'site.configure'
      ) {
        if (sender.kind !== 'ui') throw new BoundaryError('FORBIDDEN');
        if (request.type === 'site.configure') {
          await sites.configure(request.enabled, request.originalConfirmed);
          await sites.changed();
        }
        response = {
          ok: true,
          data: { kind: 'site-status', enabled: await sites.enabled() },
        };
      } else if (
        request.type === 'controls.read' ||
        request.type === 'controls.select'
      ) {
        if (sender.kind !== 'ui') throw new BoundaryError('FORBIDDEN');
        if (request.type === 'controls.select') {
          cancelAll();
          const ticket = epoch;
          if (request.provider === 'google') {
            if (!(await google.setEnabled(true)))
              throw new BoundaryError('UNAVAILABLE');
          } else if (
            request.provider === 'ai' ||
            request.provider === 'google-cloud'
          ) {
            if (!(await (request.provider === 'ai' ? ai : cloud).permitted()))
              throw new BoundaryError('UNAVAILABLE');
          }
          await selection.set(request.provider, () => ticket === epoch);
        }
        const selected = await selection.read();
        const profile = await ai.profile();
        response = {
          ok: true,
          data: {
            kind: 'controls',
            selected:
              selected === 'google' && !(await google.enabled())
                ? 'none'
                : selected,
            aiHost:
              `${new URL(profile.endpoint).origin}/*` as 'https://api.openai.com/*',
          },
        };
      } else if (
        request.type === 'content.translate' ||
        request.type === 'content.cancel'
      ) {
        if (sender.kind !== 'content') throw new BoundaryError('FORBIDDEN');
        const ticket = epoch;
        const valid = () => {
          if (ticket !== epoch) throw new TranslationFailure('CANCELLED');
          sessions.assertBound(request.sessionId, sender.identity);
        };
        valid();
        if (request.type === 'content.cancel') {
          work.cancel(request.sessionId, request.jobId);
          google.cancel(request.sessionId, request.jobId);
          ai.cancel(request.sessionId, request.jobId);
          cloud.cancel(request.sessionId, request.jobId);
          response = { ok: true, data: { kind: 'saved' } };
        } else {
          const attempt: NonNullable<PopupStatus['recent']> = {
            phase: 'pending',
            error: null,
            at: Date.now(),
            durationMs: null,
          };
          if (request.job.priority !== 'prefetch')
            record(sender.identity.tabId, attempt);
          const finish = (error: TranslationErrorCode | null) => {
            if (recent.get(sender.identity.tabId) !== attempt) return;
            if (error === 'CANCELLED') {
              recent.delete(sender.identity.tabId);
              return;
            }
            record(sender.identity.tabId, {
              phase: error ? 'error' : 'success',
              error,
              at: Date.now(),
              durationMs: Math.max(0, Date.now() - attempt.at),
            });
          };
          const preferences = await settings.read();
          try {
            valid();
            const selected = await selection.read();
            valid();
            if (selected === 'none') throw new TranslationFailure('OFF');
            if (
              new Set(request.job.items.map((item) => item.id)).size !==
              request.job.items.length
            )
              throw new TranslationFailure('RESPONSE');
            if (preferences.displayMode === 'original')
              throw new TranslationFailure('OFF');
            const provider =
              selected === 'ai'
                ? ai
                : selected === 'google-cloud'
                  ? cloud
                  : google;
            const profile =
              selected === 'ai'
                ? await ai.profile()
                : selected === 'google-cloud'
                  ? CLOUD_PROFILE
                  : {
                      endpoint:
                        'https://translate.googleapis.com/translate_a/single',
                      model: 'gtx',
                    };
            if (selected === 'google') {
              if (!(await google.enabled()))
                throw new TranslationFailure('OFF');
            } else {
              const paid = selected === 'ai' ? ai : cloud;
              if (!(await paid.permitted()))
                throw new TranslationFailure('PERMISSION');
              if (
                !(await credentials.readForOrigin(
                  selected === 'ai' ? 'ai' : 'google-cloud',
                  new URL(profile.endpoint).origin,
                ))
              )
                throw new TranslationFailure('AI_KEY');
            }
            valid();
            const result = await work.run({
              provider: selected,
              config: {
                provider: selected,
                configVersion: 1,
                ...profile,
                source: preferences.sourceLanguage,
                target: preferences.targetLanguage,
                options: { format: 'text' },
              },
              paid: selected !== 'google',
              tabId: sender.identity.tabId,
              sessionId: request.sessionId,
              job: request.job,
              valid,
              cancel: () =>
                provider.cancel(request.sessionId, request.job.jobId),
              perform: (check) =>
                provider.translate(
                  sender.identity.tabId,
                  request.sessionId,
                  request.job,
                  preferences,
                  check,
                ),
            });
            valid();
            if (
              !(selected === 'google'
                ? await google.enabled()
                : await (selected === 'ai' ? ai : cloud).permitted())
            )
              throw new TranslationFailure('PERMISSION');
            valid();
            finish(null);
            response = {
              ok: true,
              data: { kind: 'translation', result: { ok: true, ...result } },
            };
          } catch (error) {
            if (!(error instanceof TranslationFailure)) throw error;
            finish(error.code);
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
        request.type === 'cache.status' ||
        request.type === 'cache.configure' ||
        request.type === 'cache.clear' ||
        request.type === 'data.clear'
      ) {
        if (sender.kind !== 'ui' || sender.page !== 'options')
          throw new BoundaryError('FORBIDDEN');
        if (request.type !== 'cache.status') cancelAll();
        if (request.type === 'cache.configure')
          await work.cache.configure(request.persistent);
        if (request.type === 'cache.clear') await work.cache.clear();
        if (request.type === 'data.clear') {
          await work.clearData();
          await sites.configure(false, false);
          await sites.changed();
          await credentials.delete('ai');
          await credentials.delete('google-cloud');
          await google.setEnabled(false);
          await selection.set('none');
          await storage.run(async ({ local }) => {
            await local.remove(['ai-profile.v1', 'settings.v1']);
          });
        }
        response = {
          ok: true,
          data: { kind: 'cache-status', persistent: await work.cache.policy() },
        };
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
        if (
          sender.page !== 'options' &&
          request.type !== 'settings.read' &&
          request.type !== 'controls.update'
        )
          throw new BoundaryError('FORBIDDEN');
        switch (request.type) {
          case 'settings.read':
            response = {
              ok: true,
              data: { kind: 'settings', settings: await settings.read() },
            };
            break;
          case 'settings.update':
          case 'controls.update': {
            const prior = await settings.read();
            const languageChanged =
              prior.sourceLanguage !== request.preferences.sourceLanguage ||
              prior.targetLanguage !== request.preferences.targetLanguage;
            if (languageChanged) cancelAll();
            else if (prior.displayMode !== request.preferences.displayMode) {
              work.cancel();
              google.cancelAll();
              ai.cancelAll();
              cloud.cancelAll();
            }
            response = {
              ok: true,
              data: {
                kind: 'settings',
                settings: await settings.update(request.preferences),
              },
            };
            if (languageChanged) cancelAll();
            break;
          }
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
      await sessions.flush();
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
  return {
    dispatch,
    sessions,
    google,
    ai,
    cloud,
    selection,
    sites,
    cancelAll,
    work,
  };
}
