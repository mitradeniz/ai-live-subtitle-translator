// Included only in a temporary test copy, never the production extension.
void (async () => {
  const send = (type, extra = {}) =>
    chrome.runtime.sendMessage({
      version: 1,
      requestId: 'content-probe',
      type,
      ...extra,
    });
  const results = {};
  for (const area of ['local', 'session']) {
    try {
      await chrome.storage[area].get(null);
      results[area] = 'accessible';
    } catch {
      results[area] = 'denied';
    }
  }
  results.settings = await send('settings.read');
  results.export = await send('settings.export');
  results.status = await send('credentials.status', { credentialId: 'ai' });
  results.delete = await send('credentials.delete', { credentialId: 'ai' });
  results.read = await send('credentials.read', { credentialId: 'ai' });
  results.forged = await send('settings.read', {
    sender: { url: `chrome-extension://${chrome.runtime.id}/options.html` },
  });
  results.sessionRequest = await send('content.settings', {
    sessionId: crypto.randomUUID(),
  });
  document.documentElement.setAttribute(
    'data-boundary-results',
    JSON.stringify(results),
  );
})();
