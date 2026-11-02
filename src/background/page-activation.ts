import { browser } from 'wxt/browser';
import { readWithDeadline, ReadTimeout } from '../messaging/deadline.ts';
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
  const perform = async (
    operation: Parameters<PageHandler>[0],
    run: boolean,
    autoTab?: number,
    expectedDocument?: string,
    authorized?: () => Promise<boolean>,
  ) => {
    const tab =
      autoTab === undefined
        ? (await browser.tabs.query({ active: true, currentWindow: true }))[0]
        : await browser.tabs.get(autoTab);
    if (authorized && !(await authorized())) return 'off';
    if (tab?.id === undefined || tab.incognito) return 'unavailable';
    const tabId = tab.id;
    if (operation !== 'page.enable') {
      if (operation === 'page.disable') invalidate(tabId);
      try {
        const response = browser.tabs.sendMessage(
          tabId,
          {
            version: 1,
            type: operation === 'page.disable' ? 'page.stop' : 'page.inspect',
          },
          { frameId: 0 },
        );
        return PageStateSchema.parse(
          operation === 'page.status'
            ? await readWithDeadline(response, 1500)
            : await response,
        );
      } catch (error) {
        return error instanceof ReadTimeout ? 'unavailable' : 'off';
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
      if (
        !documentId ||
        (expectedDocument && documentId !== expectedDocument) ||
        operations.get(tabId) !== ticket ||
        (authorized && !(await authorized()))
      )
        return 'off';
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
      if (
        operations.get(tabId) !== ticket ||
        (authorized && !(await authorized()))
      ) {
        if (operations.get(tabId) === ticket) sessions.revokeTab(tabId);
        return 'off';
      }
      const state = PageStateSchema.parse(
        await browser.tabs.sendMessage(
          tabId,
          {
            version: 1,
            type: 'page.start',
            sessionId,
            run,
            reveal: autoTab === undefined,
          },
          { documentId },
        ),
      );
      if (
        operations.get(tabId) !== ticket ||
        (authorized && !(await authorized()))
      ) {
        if (operations.get(tabId) === ticket) {
          sessions.revokeTab(tabId);
          await browser.tabs
            .sendMessage(
              tabId,
              { version: 1, type: 'page.stop' },
              { documentId },
            )
            .catch(() => {});
        }
        return 'off';
      }
      return state;
    } catch {
      if (operations.get(tabId) === ticket) sessions.revokeTab(tabId);
      return 'unavailable';
    }
  };
  return {
    handle: ((operation, run) => perform(operation, run)) as PageHandler,
    auto: (
      tabId: number,
      documentId: string,
      authorized: () => Promise<boolean>,
    ) => perform('page.enable', false, tabId, documentId, authorized),
    invalidate,
  };
}
