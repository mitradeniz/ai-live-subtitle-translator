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
      tools?.dispose();
      tools = undefined;
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
