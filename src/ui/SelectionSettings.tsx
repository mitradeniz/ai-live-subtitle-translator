import { useEffect, useRef, useState } from 'react';
import { sendRequest } from '../messaging/client';
import { useI18n } from './useI18n';

export function SelectionSettings() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('');
  const revision = useRef(0);
  const writing = useRef(false);
  useEffect(() => {
    let current = true;
    const read = () => {
      if (writing.current) return;
      const ticket = ++revision.current;
      void sendRequest({ type: 'page.preferences' })
        .then((data) => {
          if (
            current &&
            ticket === revision.current &&
            data.kind === 'page-preferences'
          ) {
            setEnabled(
              data.preferences.selection && data.preferences.autoSelection,
            );
            setBusy(false);
          }
        })
        .catch(() => {
          if (current && ticket === revision.current)
            setStatus('Could not save page preferences.');
        });
    };
    read();
    window.addEventListener('focus', read);
    return () => {
      current = false;
      window.removeEventListener('focus', read);
    };
  }, []);
  async function update(value: boolean) {
    const previous = enabled;
    writing.current = true;
    revision.current++;
    setEnabled(value);
    setBusy(true);
    try {
      const data = await sendRequest({ type: 'page.preferences' });
      if (data.kind !== 'page-preferences') throw new Error();
      await sendRequest({
        type: 'page.configure',
        preferences: {
          ...data.preferences,
          autoSelection: value,
          selection: value || data.preferences.selection,
        },
      });
      setEnabled(value);
      setStatus('Preferences saved. Enable page tools to use them here.');
    } catch {
      setEnabled(previous);
      setStatus('Could not save page preferences.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="glass-panel"
      aria-label={t('Selected text translation')}
    >
      <h2>{t('Selected text translation')}</h2>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(event) => void update(event.target.checked)}
        />{' '}
        {t('Translate automatically after selection')}
      </label>
      <p>
        {t(
          'Selecting text sends it to your selected provider. Paid providers may charge per selection.',
        )}
      </p>
      <p>
        {t(
          'Uses your selected provider and target language on pages where page tools are enabled.',
        )}
      </p>
      {status && <p role="status">{t(status)}</p>}
    </section>
  );
}
