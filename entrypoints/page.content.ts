import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { withinMessageBudget } from '../src/messaging/protocol';
import { PageControlSchema } from '../src/page/contracts';
import { sendRequest } from '../src/messaging/client';
import { PageTools } from '../src/page/tools';
export default defineContentScript({
  registration: 'runtime',
  noScriptStartedPostMessage: true,
  main(ctx) {
    let tools: PageTools | undefined;
    let generation = 0;
    // Position and a "hide until reload" choice survive tool restarts in this
    // document (navigation inside the page, settings changes). Each start runs
    // this script again, so keep them on the extension's isolated-world global,
    // which the page cannot read.
    const store = globalThis as typeof globalThis & {
      __translatorEdgePlacement?: PageTools['placement'];
    };
    const remember = (placement: PageTools['placement']) => {
      store.__translatorEdgePlacement = placement;
    };
    const release = () => {
      tools?.dispose();
      tools = undefined;
    };
    const reloadMenu = async (sessionId: string, resume = false) => {
      const ticket = ++generation;
      release();
      const data = await sendRequest({ type: 'page.settings', sessionId });
      if (
        !ctx.isValid ||
        ticket !== generation ||
        data.kind !== 'page-settings'
      )
        return;
      tools = new PageTools(
        sessionId,
        data.preferences,
        data.settings,
        data.label,
        data.ai,
        reloadMenu,
        remember,
      );
      const placement = store.__translatorEdgePlacement;
      if (placement) tools.restorePlacement(placement);
      tools.openPlayerMenu(resume);
    };
    const onMessage: Parameters<
      typeof browser.runtime.onMessage.addListener
    >[0] = (raw: unknown, sender, respond) => {
      if (
        sender.id !== browser.runtime.id ||
        sender.tab ||
        !withinMessageBudget(raw)
      )
        return;
      const parsed = PageControlSchema.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'page.inspect') {
        respond(tools?.state ?? 'off');
        return;
      }
      const ticket = ++generation;
      release();
      if (message.type !== 'page.start') {
        respond('off');
        return;
      }
      void sendRequest({
        type: 'page.settings',
        sessionId: message.sessionId,
      }).then(
        (data) => {
          if (
            !ctx.isValid ||
            ticket !== generation ||
            data.kind !== 'page-settings'
          ) {
            respond('off');
            return;
          }
          tools = new PageTools(
            message.sessionId,
            data.preferences,
            data.settings,
            data.label,
            data.ai,
            reloadMenu,
            remember,
          );
          const placement = store.__translatorEdgePlacement;
          if (placement)
            tools.restorePlacement(
              message.reveal ? { ...placement, hidden: false } : placement,
            );
          if (message.run) tools.startPage();
          respond(tools.state);
        },
        () => respond('unavailable'),
      );
      return true;
    };
    browser.runtime.onMessage.addListener(onMessage);
    const dispose = () => {
      generation++;
      tools?.dispose();
      tools = undefined;
    };
    window.addEventListener('pagehide', dispose);
    ctx.onInvalidated(() => {
      dispose();
      window.removeEventListener('pagehide', dispose);
      browser.runtime.onMessage.removeListener(onMessage);
    });
  },
});
