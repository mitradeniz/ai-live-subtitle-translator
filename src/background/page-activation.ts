import { browser } from 'wxt/browser';
import { PageStateSchema, type PageHandler } from '../page/contracts.ts';
import type { SessionRegistry } from './sessions.ts';
export function createPageHandler(sessions: SessionRegistry) {
  const operations = new Map<number, number>();
  const invalidate = (tabId: number) => {
    operations.set(tabId, (operations.get(tabId) ?? 0) + 1);
    if (operations.size > 256)
      operations.delete(operations.keys().next().value!);
    sessions.revokeTab(tabId);
  };
  const handle: PageHandler = async (operation, run) => {
    const tab = (
      await browser.tabs.query({ active: true, currentWindow: true })
    )[0];
    if (tab?.id === undefined || tab.incognito) return 'unavailable';
    const tabId = tab.id;
    if (operation !== 'page.enable') {
      if (operation === 'page.disable') invalidate(tabId);
      try {
        return PageStateSchema.parse(
          await browser.tabs.sendMessage(
            tabId,
            {
              version: 1,
              type: operation === 'page.disable' ? 'page.stop' : 'page.inspect',
            },
            { frameId: 0 },
          ),
        );
      } catch {
        return 'off';
      }
    }
    invalidate(tabId);
    const ticket = operations.get(tabId);
    try {
      if (import.meta.env.MODE === 'mock') return 'unavailable';
      const url = new URL(tab.url ?? '');
      if (!['https:', 'http:'].includes(url.protocol)) return 'unavailable';
      const results = await browser.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ['/content-scripts/page.js'],
        world: 'ISOLATED',
      });
      const documentId = results.find((item) => item.frameId === 0)?.documentId;
      if (!documentId || operations.get(tabId) !== ticket) return 'off';
      const sessionId = sessions.grant({
        id: browser.runtime.id,
        url: url.href,
        origin: url.origin,
        documentId,
        documentLifecycle: 'active',
        frameId: 0,
        tab: { id: tabId, incognito: false },
      });
      await sessions.flush();
      if (operations.get(tabId) !== ticket) return 'off';
      const state = PageStateSchema.parse(
        await browser.tabs.sendMessage(
          tabId,
          { version: 1, type: 'page.start', sessionId, run },
          { documentId },
        ),
      );
      if (operations.get(tabId) !== ticket) return 'off';
      return state;
    } catch {
      if (operations.get(tabId) === ticket) sessions.revokeTab(tabId);
      return 'unavailable';
    }
  };
  return { handle, invalidate };
}
