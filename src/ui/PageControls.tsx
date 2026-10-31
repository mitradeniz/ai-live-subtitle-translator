import { EDGE_ALL_HOSTS } from '../background/edge-sites';
import { browser } from 'wxt/browser';
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
  const [site, setSite] = useState<{
    origin: string | null;
    enabled: boolean;
    allSites: boolean;
  }>({ origin: null, enabled: false, allSites: false });
  const [message, setMessage] = useState('');
  const enabled = state !== 'off' && state !== 'unavailable';
  useEffect(() => {
    let active = true;
    void Promise.all([
      sendRequest({ type: 'page.preferences' }),
      sendRequest({ type: 'page.status' }),
      sendRequest({ type: 'page.site-status' }),
    ])
      .then(([preferences, status, edge]) => {
        if (active && edge.kind === 'edge-site') setSite(edge);
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
  async function everywhere(enabled: boolean) {
    setBusy(true);
    try {
      if (
        enabled &&
        !(await browser.permissions.request({ origins: EDGE_ALL_HOSTS }))
      ) {
        setMessage('All-sites access was not granted. You can try again.');
        return;
      }
      const result = await sendRequest({
        type: 'page.global-configure',
        enabled,
      });
      if (result.kind === 'edge-site') setSite(result);
      setState(enabled ? 'ready' : 'off');
      setMessage(
        enabled
          ? 'The logo stays on across sites until you turn it off. Showing it does not translate anything.'
          : 'Automatic logo turned off on all sites.',
      );
    } catch {
      setMessage(
        'Could not update site access. Open this page again and retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function automatic(enabled: boolean) {
    if (!site.origin) return;
    setBusy(true);
    try {
      // Invoke synchronously from the checkbox gesture, for this exact origin only.
      if (
        enabled &&
        !(await browser.permissions.request({ origins: [`${site.origin}/*`] }))
      ) {
        setMessage(
          'Site access was not granted. You can still enable tools for this visit.',
        );
        return;
      }
      const result = await sendRequest({
        type: 'page.site-configure',
        enabled,
      });
      if (result.kind === 'edge-site') setSite(result);
      setState(enabled ? 'ready' : 'off');
      setMessage(
        enabled
          ? 'The logo will appear automatically on this site. Showing it does not translate anything.'
          : 'Automatic logo disabled for this site.',
      );
    } catch {
      setMessage(
        'Could not update site access. Open this page again and retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function update(patch: Partial<PagePreferences>) {
    setBusy(true);
    try {
      const next = { ...prefs, ...patch };
      if (patch.selection === false) next.autoSelection = false;
      if (patch.autoSelection === true) next.selection = true;
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
      setState(site.enabled ? 'ready' : 'off');
      setMessage(
        site.enabled
          ? 'Preferences saved. The logo will refresh automatically.'
          : 'Preferences saved. Enable page tools to use them here.',
      );
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
              : 'Page tools ready. Click the edge button for actions.',
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
      <label className="page-auto-site">
        <input
          type="checkbox"
          checked={site.allSites}
          disabled={busy}
          onChange={(event) => void everywhere(event.target.checked)}
        />
        {t('Show the logo on all sites')}
      </label>
      <p className="page-consent">
        {t(
          'Allow access once for all websites. The logo stays visible until you turn this off; showing it does not translate anything.',
        )}
      </p>
      <details className="page-customize">
        <summary>{t('Customize translation')}</summary>
        {!site.allSites && (
          <label className="page-auto-site">
            <input
              type="checkbox"
              checked={site.enabled}
              disabled={busy || !site.origin}
              onChange={(event) => void automatic(event.target.checked)}
            />
            {t('Always show the logo on this site')}
          </label>
        )}
        {site.origin && <small className="page-consent">{site.origin}</small>}
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
            <input
              type="checkbox"
              checked={prefs.autoSelection}
              onChange={(event) =>
                void update({ autoSelection: event.target.checked })
              }
            />
            {t('Translate automatically after selection')}
          </label>
          <small className="page-consent">
            {t(
              'When this is off, click the icon next to selected text to translate it.',
            )}{' '}
            {t(
              'Selecting text sends it to your selected provider. Paid providers may charge per selection.',
            )}
          </small>
          {prefs.captions && (
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
              <option value="translated">{t('Translation only')}</option>
              <option value="bilingual">{t('Original and translation')}</option>
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
