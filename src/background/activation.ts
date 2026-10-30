import { browser } from 'wxt/browser';
import {
  PlaybackStateSchema,
  type PlaybackHandler,
} from '../messaging/playback.ts';
import type { SessionRegistry } from './sessions.ts';
import { isYouTubeWatch } from '../youtube/source.ts';

export function createPlaybackHandler(
  sessions: SessionRegistry,
  pause: (tabId: number, paused: boolean) => Promise<void> = async () => {},
) {
  const operations = new Map<number, number>();
  const perform = async (
    type: Parameters<PlaybackHandler>[0],
    youtubeSourceConfirmed: boolean,
    automaticTab?: number,
    expectedDocument?: string,
    authorized?: () => Promise<boolean>,
  ) => {
    // No tab/document identity is accepted from the popup payload.
    const tab =
      automaticTab === undefined
        ? (await browser.tabs.query({ active: true, currentWindow: true }))[0]
        : await browser.tabs.get(automaticTab);
    if (tab?.id === undefined || tab.incognito) return 'unavailable';
    const tabId = tab.id;
    const ticket =
      (operations.get(tabId) ?? 0) + (type === 'playback.status' ? 0 : 1);
    operations.set(tabId, ticket);
    const current = async () =>
      (!authorized || (await authorized())) && ticket === operations.get(tabId);
    if (automaticTab !== undefined && !isYouTubeWatch(tab.url ?? ''))
      return 'unavailable';
    if (automaticTab === undefined && type !== 'playback.status')
      await pause(tabId, type === 'playback.disable');
    if (type !== 'playback.enable') {
      if (type === 'playback.disable') {
        sessions.revokeTab(tabId);
      }
      try {
        const state: unknown = await browser.tabs.sendMessage(
          tabId,
          {
            version: 1,
            type:
              type === 'playback.disable'
                ? 'playback.stop'
                : 'playback.inspect',
          },
          { frameId: 0 },
        );
        return PlaybackStateSchema.parse(state);
      } catch {
        return 'disabled';
      }
    }
    try {
      if (!(await current())) return 'disabled';
      const url = new URL(tab.url ?? '');
      const youtube = isYouTubeWatch(url.href);
      if (youtube && !youtubeSourceConfirmed) return 'source-required';
      if (!['http:', 'https:'].includes(url.protocol)) return 'unavailable';
      if (
        import.meta.env.MODE === 'mock' &&
        url.origin !== 'http://127.0.0.1:4173' &&
        !youtube
      )
        return 'unavailable';
      const results = await browser.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ['/content-scripts/captions.js'],
        world: 'ISOLATED',
      });
      const injection = results.find((result) => result.frameId === 0);
      if (
        !(await current()) ||
        !injection?.documentId ||
        (expectedDocument && injection.documentId !== expectedDocument)
      )
        return 'disabled';
      if (youtube) {
        await browser.scripting.executeScript({
          target: { tabId, documentIds: [injection.documentId] },
          files: ['/youtube-source.js'],
          world: 'MAIN',
        });
        if (!(await current())) return 'disabled';
      }
      // Every field comes from browser APIs, including the actual injected document.
      // The content request independently checks origin/document via onMessage sender.
      const sessionId = sessions.grant({
        id: browser.runtime.id,
        url: url.href,
        origin: url.origin,
        documentId: injection.documentId,
        documentLifecycle: 'active',
        frameId: 0,
        tab: { id: tabId, incognito: false },
      });
      await sessions.flush();
      if (!(await current())) {
        if (ticket === operations.get(tabId)) sessions.revokeTab(tabId);
        return 'disabled';
      }
      const state: unknown = await browser.tabs.sendMessage(
        tabId,
        {
          version: 1,
          type: 'playback.start',
          sessionId,
          youtubeSourceConfirmed,
        },
        { documentId: injection.documentId },
      );
      if (!(await current())) {
        if (ticket === operations.get(tabId)) {
          sessions.revokeTab(tabId);
          await browser.tabs
            .sendMessage(
              tabId,
              { version: 1, type: 'playback.stop' },
              { documentId: injection.documentId },
            )
            .catch(() => {});
        }
        return 'disabled';
      }
      const result = PlaybackStateSchema.parse(state);
      if (result !== 'enabled') sessions.revokeTab(tabId);
      return result;
    } catch {
      if (ticket === operations.get(tabId)) sessions.revokeTab(tabId);
      return 'unavailable';
    }
  };
  return {
    handle: ((type, confirmed) => perform(type, confirmed)) as PlaybackHandler,
    auto: (
      tabId: number,
      documentId: string,
      authorized: () => Promise<boolean>,
    ) => perform('playback.enable', true, tabId, documentId, authorized),
    invalidate(tabId: number) {
      operations.set(tabId, (operations.get(tabId) ?? 0) + 1);
      if (operations.size > 256)
        operations.delete(operations.keys().next().value!);
      sessions.revokeTab(tabId);
    },
  };
}
