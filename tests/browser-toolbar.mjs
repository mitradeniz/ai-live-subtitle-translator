import assert from 'node:assert/strict';

// action.openPopup creates a real toolbar view that Playwright does not expose
// in context.pages(). Attach to that test-browser target, not a popup.html tab.
// This does not simulate the user's activeTab grant.
export async function openToolbarPopup(context, worker) {
  const cdp = await context.browser().newBrowserCDPSession();
  await worker.evaluate(() => chrome.action.openPopup());
  const { targetInfos } = await cdp.send('Target.getTargets');
  const id = new URL(worker.url()).hostname;
  const target = targetInfos.find(
    (entry) =>
      entry.url === `chrome-extension://${id}/popup.html` && !entry.attached,
  );
  assert.ok(target, 'Actual toolbar popup target must exist');
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: false,
  });
  let serial = 0;
  async function evaluate(fn, arg = null, userGesture = false) {
    const requestId = ++serial;
    let listener;
    let timer;
    const response = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Toolbar test timed out')),
        10_000,
      );
      listener = (event) => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);
        if (message.id === requestId) resolve(message);
      };
      cdp.on('Target.receivedMessageFromTarget', listener);
    });
    try {
      await cdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({
          id: requestId,
          method: 'Runtime.evaluate',
          params: {
            expression: `(${fn.toString()})(${JSON.stringify(arg)})`,
            awaitPromise: true,
            userGesture,
            returnByValue: true,
          },
        }),
      });
      const message = await response;
      assert.equal(message.error, undefined);
      assert.equal(message.result.exceptionDetails, undefined);
      return message.result.result.value;
    } finally {
      clearTimeout(timer);
      cdp.off('Target.receivedMessageFromTarget', listener);
    }
  }
  await evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!document.querySelector('.popup-controls button')) {
      if (Date.now() > deadline) throw new Error('Toolbar UI did not render');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
  return {
    evaluate,
    async close() {
      await cdp.send('Target.closeTarget', { targetId: target.targetId });
      await cdp.detach();
    },
  };
}
