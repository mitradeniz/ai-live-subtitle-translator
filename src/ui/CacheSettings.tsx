import { useEffect, useState } from 'react';
import { sendRequest } from '../messaging/client';
export function CacheSettings() {
  const [persistent, setPersistent] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void sendRequest({ type: 'cache.status' })
      .then((data) => {
        if (active && data.kind === 'cache-status')
          setPersistent(data.persistent);
      })
      .catch(() => {
        if (active) setMessage('Cache settings unavailable.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function action(
    type: 'cache.configure' | 'cache.clear' | 'data.clear',
  ) {
    setBusy(true);
    try {
      await sendRequest(
        type === 'cache.configure' ? { type, persistent } : { type },
      );
      setMessage(
        type === 'data.clear'
          ? 'Local data deleted. Reopen settings to see defaults.'
          : 'Cache updated. Re-enable captions to continue.',
      );
      if (type === 'data.clear') setPersistent(false);
    } catch {
      setMessage('Could not update cache. Check extension errors.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="glass-panel google-panel" aria-labelledby="cache-title">
      <h2 id="cache-title">Translation cache</h2>
      <p>
        Timed tracks may send up to 20 seconds of upcoming captions to the
        selected provider while playing. This can use quota for captions you
        skip. Visible YouTube captions have no lookahead.
      </p>
      <p>
        Translations stay in this browser session by default, up to 128 batches
        and 256 KiB, expiring after 30 minutes. Private browsing is unsupported.
      </p>
      <fieldset disabled={busy}>
        <legend className="visually-hidden">Cache controls</legend>
        <label className="key-retention">
          <input
            type="checkbox"
            checked={persistent}
            onChange={(event) => setPersistent(event.target.checked)}
          />
          Remember translations for up to 24 hours on this device
        </label>
        <p className="field-help">
          Optional device cache also holds at most 128 batches / 256 KiB.
          Translated text is not encrypted or anonymous. Expired entries are
          ignored and removed on access. No keys are cached.
        </p>
        <div className="actions">
          <button type="button" onClick={() => void action('cache.configure')}>
            Save cache preference
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void action('cache.clear')}
          >
            Clear translation cache
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (
                window.confirm(
                  'Delete saved keys, preferences, translations and playback sessions? Provider request budgets and uncertain-request guards remain until this browser session ends.',
                )
              )
                void action('data.clear');
            }}
          >
            Delete saved data and keys
          </button>
        </div>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
