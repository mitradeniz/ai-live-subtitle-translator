import { useEffect, useState } from 'react';
import { sendRequest } from '../messaging/client';
import {
  DEFAULT_PAGE_PREFERENCES,
  type PagePreferences,
  type PageState,
} from '../page/contracts';
import { useI18n } from './useI18n';
export function PageControls({
  prepare,
  captions,
}: {
  prepare: () => Promise<void>;
  captions: (show: boolean) => void;
}) {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<PagePreferences>(DEFAULT_PAGE_PREFERENCES);
  const [state, setState] = useState<PageState>('off');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const enabled = state !== 'off' && state !== 'unavailable';
  useEffect(() => {
    let active = true;
    void Promise.all([
      sendRequest({ type: 'page.preferences' }),
      sendRequest({ type: 'page.status' }),
    ])
      .then(([preferences, status]) => {
        if (!active) return;
        if (preferences.kind === 'page-preferences') {
          setPrefs(preferences.preferences);
          captions(preferences.preferences.captions);
        }
        if (status.kind === 'page-state') setState(status.state);
      })
      .catch(() => {
        if (active) setMessage('Page tools unavailable.');
      });
    return () => {
      active = false;
    };
  }, [captions]);
  async function update(patch: Partial<PagePreferences>) {
    setBusy(true);
    try {
      const next = { ...prefs, ...patch };
      if (!next[next.clickAction])
        next.clickAction =
          (['page', 'captions', 'selection', 'input', 'writing'] as const).find(
            (key) => next[key],
          ) ?? 'page';
      await sendRequest({ type: 'page.configure', preferences: next });
      if (patch.captions === false)
        await sendRequest({ type: 'playback.disable' });
      setPrefs(next);
      captions(next.captions);
      setState('off');
      setMessage('Preferences saved. Enable page tools to use them here.');
    } catch {
      setMessage('Could not save page preferences.');
    } finally {
      setBusy(false);
    }
  }
  async function activate(run: boolean) {
    setBusy(true);
    try {
      await prepare();
      const result = await sendRequest({ type: 'page.enable', run });
      if (result.kind === 'page-state') {
        setState(result.state);
        setMessage(
          result.state === 'unavailable'
            ? 'Page access unavailable. Open a regular webpage and click the extension again.'
            : run
              ? 'Translating visible text. Scroll to translate more.'
              : 'Page tools ready. Hover over the edge button for actions.',
        );
      }
    } catch {
      setMessage(
        'Page access unavailable. Open a regular webpage and click the extension again.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    setBusy(true);
    try {
      await sendRequest({ type: 'page.disable' });
      setState('off');
      setMessage('Original page restored.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page-card" aria-label={t('Page translation')}>
      <div className="page-card-heading">
        <strong>{t('Page translation')}</strong>
        <span className={`page-pill ${enabled ? 'on' : ''}`}>
          {t(enabled ? 'Page tools on' : 'Off')}
        </span>
      </div>
      <details className="page-customize">
        <summary>{t('Customize translation')}</summary>
        <fieldset disabled={busy}>
          <legend>{t('Choose your tools')}</legend>
          {(
            [
              ['page', 'Web page translation'],
              ['captions', 'Video subtitles'],
              ['selection', 'Selected text translation'],
              ['hover', 'Hover translation (Alt + hover)'],
              ['input', 'Text field translation'],
              ['writing', 'AI Writing'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={prefs[key]}
                onChange={(event) =>
                  void update({ [key]: event.target.checked })
                }
              />
              {t(label)}
            </label>
          ))}
          <label>
            {t('Edge button action')}
            <select
              value={prefs.clickAction}
              onChange={(event) =>
                void update({
                  clickAction: event.target
                    .value as PagePreferences['clickAction'],
                })
              }
            >
              {(
                [
                  ['page', 'Translate visible page'],
                  ['captions', 'Video subtitles'],
                  ['selection', 'Translate selection'],
                  ['input', 'Translate focused field'],
                  ['writing', 'AI Writing'],
                ] as const
              ).map(([key, label]) => (
                <option key={key} value={key} disabled={!prefs[key]}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          {prefs.clickAction === 'captions' && (
            <label>
              <input
                type="checkbox"
                checked={prefs.youtubeSourceConfirmed}
                onChange={(event) =>
                  void update({ youtubeSourceConfirmed: event.target.checked })
                }
              />
              {t(
                'For YouTube: I selected an original caption track, not Auto-translate.',
              )}
            </label>
          )}
          <label>
            {t('Page display')}
            <select
              value={prefs.display}
              onChange={(event) =>
                void update({
                  display: event.target.value as PagePreferences['display'],
                })
              }
            >
              <option value="bilingual">{t('Original and translation')}</option>
              <option value="translated">{t('Translation only')}</option>
            </select>
          </label>
        </fieldset>
      </details>
      <p className="page-consent">
        {t(
          'Visible text goes to your selected provider as you scroll. User-key services may charge. Fields are sent only by an explicit action.',
        )}
      </p>
      <button
        className="page-translate-button"
        disabled={busy || !prefs.page}
        onClick={() => void activate(true)}
      >
        {t('Translate visible page')}
      </button>
      <div className="page-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void activate(false)}
        >
          {t('Enable edge tools')}
        </button>
        <button
          className="secondary"
          disabled={busy || !enabled}
          onClick={() =>
            void restore().catch(() =>
              setMessage(
                'Could not restore the page. Refresh it to show originals.',
              ),
            )
          }
        >
          {t('Restore original page')}
        </button>
      </div>
      {message && (
        <p className="page-feedback" aria-live="polite">
          {t(message)}
        </p>
      )}
    </section>
  );
}
