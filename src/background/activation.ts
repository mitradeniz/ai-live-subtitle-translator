import { browser } from 'wxt/browser';
import {
  PlaybackStateSchema,
  type PlaybackHandler,
} from '../messaging/playback.ts';
import type { SessionRegistry } from './sessions.ts';

export function createPlaybackHandler(sessions: SessionRegistry) {
  let operation = 0;
  const handle: PlaybackHandler = async (type) => {
    const ticket = type === 'playback.status' ? operation : ++operation;
    // No tab/document identity is accepted from the popup payload.
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (ticket !== operation && type !== 'playback.status') return 'disabled';
    if (tab?.id === undefined || tab.incognito) return 'unavailable';
    const tabId = tab.id;
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
      const url = new URL(tab.url ?? '');
      if (!['http:', 'https:'].includes(url.protocol)) return 'unavailable';
      if (
        import.meta.env.MODE === 'mock' &&
        url.origin !== 'http://127.0.0.1:4173'
      )
        return 'unavailable';
      const results = await browser.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ['/content-scripts/captions.js'],
        world: 'ISOLATED',
      });
      const injection = results.find((result) => result.frameId === 0);
      if (ticket !== operation || !injection?.documentId) return 'disabled';
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
      const state: unknown = await browser.tabs.sendMessage(
        tabId,
        {
          version: 1,
          type: 'playback.start',
          sessionId,
        },
        { documentId: injection.documentId },
      );
      if (ticket !== operation) return 'disabled';
      const result = PlaybackStateSchema.parse(state);
      if (result !== 'enabled') sessions.revokeTab(tabId);
      return result;
    } catch {
      sessions.revokeTab(tabId);
      return 'unavailable';
    }
  };
  return {
    handle,
    invalidate(tabId: number) {
      operation++;
      sessions.revokeTab(tabId);
    },
  };
}
