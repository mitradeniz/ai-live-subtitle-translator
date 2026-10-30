import { useI18n } from './useI18n';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendRequest } from '../messaging/client';
import { GOOGLE_HOST } from '../translation/contracts';

export function GoogleSettings() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void sendRequest({ type: 'google.status' })
        .then((data) => {
          if (active && data.kind === 'google-status') setEnabled(data.enabled);
        })
        .catch(() => {});
    };
    browser.storage.onChanged.addListener(refresh);
    const onRemoved = () => {
      void browser.permissions
        .contains({ origins: [GOOGLE_HOST] })
        .then((permitted) => {
          if (active && !permitted) setEnabled(false);
        })
        .catch(() => {
          if (active) setMessage('Google access status unavailable.');
        });
    };
    browser.permissions.onRemoved.addListener(onRemoved);
    void sendRequest({ type: 'google.status' })
      .then((data) => {
        if (active && data.kind === 'google-status') setEnabled(data.enabled);
      })
      .catch(() => {
        if (active) setMessage('Google status unavailable.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(refresh);
      browser.permissions.onRemoved.removeListener(onRemoved);
    };
  }, []);
  async function enable() {
    setBusy(true);
    setMessage('');
    try {
      // Request in the click handler, before any other asynchronous work.
      if (!(await browser.permissions.request({ origins: [GOOGLE_HOST] }))) {
        setMessage(
          'Access was not granted. Original captions remain available.',
        );
        return;
      }
      const data = await sendRequest({ type: 'google.enable' });
      if (data.kind !== 'google-status' || !data.enabled) throw new Error();
      setEnabled(true);
      setMessage(
        'Google enabled. AI is inactive. Re-enable captions on the video page.',
      );
    } catch {
      setMessage(
        'Could not enable Google. Reload the extension and try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setMessage('');
    try {
      await sendRequest({ type: 'google.disable' });
      setEnabled(false);
      await browser.permissions.remove({ origins: [GOOGLE_HOST] });
      if (await browser.permissions.contains({ origins: [GOOGLE_HOST] }))
        throw new Error();
      setMessage('Google disabled and access removed.');
    } catch {
      setMessage(
        'Could not remove access. Use the extension’s Chrome site-access controls.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="glass-panel google-panel"
      aria-labelledby="google-title"
    >
      <h2 id="google-title">{t('Google · Experimental')}</h2>
      <p>
        {t(
          'No API key or Google Cloud account. Uses an undocumented service that can change or stop working.',
        )}
      </p>
      <p>
        {t('Enabling sends caption text and language choices to')}{' '}
        <strong>{t('translate.googleapis.com')}</strong>
        {t(
          ' when you activate captions. No audio, video, website cookies or credentials are sent.',
        )}
      </p>
      <p className="field-help">
        {t(
          'Up to 20 requests/minute, 200 per browser session; one request at a time. Errors keep original captions. Turning this off stops pending work and removes access. It cannot retract text already sent.',
        )}
      </p>
      <p>
        {t('Google is ')}
        {enabled ? t('enabled') : t('off')}.
      </p>
      <div className="actions">
        <button
          type="button"
          disabled={busy || enabled}
          onClick={() => void enable()}
        >
          {t('Enable experimental Google')}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void disable()}
        >
          {t('Disable Google and remove access')}
        </button>
      </div>
      {message && <p role="status">{t(message)}</p>}
    </section>
  );
}
