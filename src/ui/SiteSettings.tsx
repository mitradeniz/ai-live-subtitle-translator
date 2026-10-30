import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendRequest } from '../messaging/client';
import { YOUTUBE_HOST } from '../background/sites';
import { useI18n } from './useI18n';
export function SiteSettings() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void sendRequest({ type: 'site.status' })
        .then((data) => {
          if (active && data.kind === 'site-status') setEnabled(data.enabled);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setBusy(false);
        });
    };
    refresh();
    browser.permissions.onRemoved.addListener(refresh);
    return () => {
      active = false;
      browser.permissions.onRemoved.removeListener(refresh);
    };
  }, []);
  function enable() {
    const grant = browser.permissions.request({ origins: [YOUTUBE_HOST] });
    setBusy(true);
    void grant
      .then(async (allowed) => {
        if (!allowed) {
          setMessage('YouTube access was not granted. You can try again.');
          return;
        }
        await sendRequest({
          type: 'site.configure',
          enabled: true,
          originalConfirmed: confirmed,
        });
        setEnabled(true);
        setMessage('Automatic captions are on.');
      })
      .catch(() => setMessage('Could not update site access. Try again.'))
      .finally(() => setBusy(false));
  }
  async function disable() {
    setBusy(true);
    try {
      await sendRequest({
        type: 'site.configure',
        enabled: false,
        originalConfirmed: false,
      });
      await browser.permissions.remove({ origins: [YOUTUBE_HOST] });
      setEnabled(false);
      setMessage('Automatic captions are off.');
    } catch {
      setMessage('Could not update site access. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="glass-panel google-panel">
      <h2>{t('Automatic captions on YouTube')}</h2>
      <p>
        {t(
          'After you allow access, captions can start on YouTube watch pages without opening the extension. Text goes to your selected provider.',
        )}
      </p>
      <fieldset disabled={busy}>
        <legend className="visually-hidden">
          {t('Automatic captions on YouTube')}
        </legend>
        <label className="key-retention">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {t('Use original YouTube captions; never Auto-translate.')}
        </label>
        <div className="actions">
          <button
            type="button"
            disabled={!confirmed || enabled}
            onClick={enable}
          >
            {t('Allow YouTube and turn on')}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void disable()}
          >
            {t('Turn off and remove access')}
          </button>
        </div>
      </fieldset>
      <p role="status">
        {t(
          message ||
            (enabled
              ? 'Automatic captions are on.'
              : 'Automatic captions are off.'),
        )}
      </p>
    </section>
  );
}
