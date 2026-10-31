import { PageControls } from './PageControls';
import { readWithDeadline } from '../messaging/deadline';
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendRequest } from '../messaging/client';
import type { PopupStatus, Settings } from '../messaging/protocol';
import type { PlaybackOperation, PlaybackState } from '../messaging/playback';
import { AI_PROFILES, aiDefinition } from '../translation/ai-profile';
import { TRANSLATION_MESSAGES } from '../translation/contracts';
import { useI18n } from './useI18n';
import { DevelopmentNotice } from './DevelopmentNotice';

type Engine = PopupStatus['selected'];
export default function PopupDashboard() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<PopupStatus | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [state, setState] = useState<PlaybackState>('disabled');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const dirty = useRef(false);
  const [edited, setEdited] = useState(false);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const loading = useRef<Promise<void> | null>(null);

  function load() {
    if (loading.current) return loading.current;
    const ticket = ++sequence.current;
    const summary = readWithDeadline(sendRequest({ type: 'popup.read' }), 5000)
      .then((summary) => {
        if (!mounted.current || ticket !== sequence.current) return;
        setLoadError('');
        if (summary.kind === 'popup-status') {
          setData(summary);
          if (!dirty.current) setDraft(summary.settings);
        }
      })
      .catch(() => {
        if (mounted.current && ticket === sequence.current)
          setLoadError('Provider status unavailable.');
      });
    // A busy/blocked page must not gate trusted settings or provider controls.
    const playback = readWithDeadline(
      sendRequest({ type: 'playback.status' }),
      5000,
    )
      .then((playback) => {
        if (
          mounted.current &&
          ticket === sequence.current &&
          playback.kind === 'playback'
        )
          setState(playback.state);
      })
      .catch(() => {
        if (mounted.current && ticket === sequence.current)
          setState('unavailable');
      });
    loading.current = Promise.all([summary, playback]).then(() => {
      loading.current = null;
    });
    return loading.current;
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    // Only local status reads; opening this popup never tests a key or translates.
    const timer = setInterval(() => void load(), 2000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch {
      setError(
        'Could not apply this change. Check settings and page access, then try again.',
      );
    } finally {
      await load();
      setBusy(false);
    }
  }
  function select(provider: Engine) {
    if (!data) return;
    const host =
      provider === 'google'
        ? 'https://translate.googleapis.com/*'
        : provider === 'google-cloud'
          ? 'https://translation.googleapis.com/*'
          : `${new URL(data.profile.endpoint).origin}/*`;
    // Begin the permission request in the direct click gesture.
    const grant =
      provider === 'none'
        ? Promise.resolve(true)
        : browser.permissions.request({ origins: [host] });
    void run(async () => {
      if (!(await grant)) {
        setMessage('Access was not granted. Your current engine is unchanged.');
        return;
      }
      await sendRequest({ type: 'controls.select', provider });
      setMessage('Provider selected. Enable captions to use it on this page.');
    });
  }
  async function save() {
    if (!draft) return;
    const { schemaVersion, ...preferences } = draft;
    void schemaVersion;
    await sendRequest({ type: 'controls.update', preferences });
    dirty.current = false;
    setEdited(false);
    setMessage(
      'Preferences saved. Enable captions again after changing languages.',
    );
  }
  function control(type: PlaybackOperation) {
    void run(async () => {
      if (dirty.current) await save();
      const result = await sendRequest(
        type === 'playback.enable'
          ? { type, youtubeSourceConfirmed: confirmed }
          : { type },
      );
      if (result.kind !== 'playback') throw new Error();
      setState(result.state);
      setMessage(
        {
          enabled:
            'Caption overlay enabled. Waiting for accessible caption text.',
          disabled: 'Caption overlay is off. Native caption state restored.',
          'needs-restart':
            'Preferences changed. Restart captions to resume translation.',
          'key-required':
            'No key saved for the selected provider. Add it in settings.',
          'permission-required':
            'Provider access is missing. Click the provider to grant access.',
          'no-video': 'No visible HTML5 video found in the main page.',
          'source-required':
            'Select a source caption track in YouTube, then confirm your selection.',
          unavailable:
            'Access unavailable. Open a regular video webpage and click the extension again.',
        }[result.state],
      );
    });
  }
  if (!data || !draft)
    return <p role="status">{t(loadError || 'Loading preferences…')}</p>;
  const currentAI = aiDefinition(data.profile).name;
  const selectedName =
    data.selected === 'ai'
      ? currentAI
      : data.selected === 'google-cloud'
        ? 'Google Cloud'
        : data.selected === 'google'
          ? 'Google'
          : t('No translation');
  const paid =
    data.selected === 'ai'
      ? data.ai
      : data.selected === 'google-cloud'
        ? data.cloud
        : null;
  const recipient =
    data.selected === 'ai'
      ? new URL(data.profile.endpoint).hostname
      : data.selected === 'google-cloud'
        ? 'translation.googleapis.com'
        : 'translate.googleapis.com';
  const warning =
    import.meta.env.MODE === 'mock'
      ? ''
      : data.settings.displayMode === 'original'
        ? 'Original only is selected. Choose Translation only or bilingual to translate.'
        : data.selected === 'none'
          ? 'Choose a provider to translate captions.'
          : paid && !paid.configured
            ? 'No key saved for the selected provider. Add it in settings.'
            : (paid && !paid.permitted) ||
                (data.selected === 'google' && !data.googlePermitted)
              ? 'Provider access is missing. Click the provider to grant access.'
              : data.recent?.error
                ? TRANSLATION_MESSAGES[data.recent.error]
                : '';
  const missingKey =
    import.meta.env.MODE !== 'mock' &&
    paid &&
    !paid.configured &&
    draft.displayMode !== 'original';
  const originalOnly =
    import.meta.env.MODE !== 'mock' &&
    (data.selected === 'none' || data.settings.displayMode === 'original');
  const isOn = state === 'enabled';
  const restart = state === 'needs-restart' || (isOn && edited);
  const attention = Boolean((warning && !originalOnly) || missingKey);
  const title =
    state === 'unavailable'
      ? 'Page status unavailable'
      : missingKey
        ? 'Translation blocked · Key missing'
        : warning && !originalOnly
          ? 'Translation needs attention'
          : restart
            ? 'Restart required'
            : isOn
              ? originalOnly
                ? 'ON · Original captions'
                : data.recent?.phase === 'pending'
                  ? 'ON · Translating…'
                  : 'ON · Captions enabled'
              : 'OFF · Captions disabled';
  const summary =
    loadError ||
    error ||
    (state === 'unavailable'
      ? 'The page is not responding. Provider controls remain available; refresh the page to reconnect.'
      : '') ||
    warning ||
    (restart
      ? 'Preferences changed. Restart captions to resume translation.'
      : data.recent?.phase === 'pending'
        ? 'Waiting for the selected provider. No fallback provider is used.'
        : (isOn && data.recent?.phase === 'success'
            ? 'Waiting for the next accessible caption.'
            : '') ||
          message ||
          (isOn
            ? 'Waiting for the next accessible caption.'
            : 'Enable captions on a video with an accessible caption track.'));
  function card(
    name: string,
    icon: string | null,
    engine: Engine,
    saved = false,
    setup = false,
    retention: string | null = null,
  ) {
    const selected =
      data!.selected === engine && (engine !== 'ai' || name === currentAI);
    return (
      <button
        key={name}
        type="button"
        className={`provider-card ${saved ? 'has-key' : setup ? 'missing-key' : ''}`}
        aria-pressed={selected}
        aria-label={`${name} · ${t(setup ? 'Set up in settings' : 'Select provider')}`}
        onClick={() =>
          setup ? void browser.runtime.openOptionsPage() : select(engine)
        }
      >
        <span className="provider-icon">
          {icon ? (
            <img src={`/providers/${icon}`} width="24" height="24" alt="" />
          ) : (
            <span aria-hidden="true">Aa</span>
          )}
        </span>
        <span className="provider-name">{name}</span>
        {saved && (
          <span
            className="saved-tick"
            aria-label={t('Key saved')}
            title={t(
              retention === 'device'
                ? 'Saved on this device'
                : 'Saved for this browser session',
            )}
          >
            ✓ {t('Key saved')}
          </span>
        )}
        <span className="provider-detail">
          {t(
            saved
              ? retention === 'device'
                ? 'On this device'
                : 'Session · Cleared on reload'
              : setup
                ? '+ Add API key'
                : engine === 'google'
                  ? 'Experimental · No key'
                  : 'No translation',
          )}
        </span>
      </button>
    );
  }
  return (
    <>
      {import.meta.env.MODE !== 'mock' && (
        <PageControls
          prepare={async () => {
            if (dirty.current) await save();
          }}
          captions={setShowCaptions}
        />
      )}
      {import.meta.env.MODE === 'mock' ? (
        <DevelopmentNotice />
      ) : (
        <>
          <fieldset className="provider-picker" disabled={busy}>
            <legend>{t('Translation provider')}</legend>
            <div className="provider-grid">
              {card('Google', 'google.ico', 'google')}
              {card(
                'Google Cloud',
                'cloud.svg',
                'google-cloud',
                data.cloud.configured,
                !data.cloud.configured,
                data.cloud.retention,
              )}
              {card(t('Original only'), null, 'none')}
              {AI_PROFILES.map((p) =>
                card(
                  p.name,
                  p.name === 'DeepSeek'
                    ? 'deepseek.svg'
                    : `${p.name.toLowerCase()}.png`,
                  'ai',
                  p.name === currentAI && data.ai.configured,
                  p.name !== currentAI || !data.ai.configured,
                  data.ai.retention,
                ),
              )}
            </div>
          </fieldset>
          <p className="key-legend">
            {t(
              'Saved keys are not automatically tested. One AI key + one Cloud key.',
            )}
          </p>
          <div className="provider-destination">
            <strong>
              {t('Selected')}: {selectedName}
            </strong>
            {data.selected !== 'none' && (
              <span>
                {t(paid ? 'Paid API · Text sent to' : 'Text sent to')}{' '}
                {recipient}
              </span>
            )}
            {data.selected === 'ai' && <span>{data.profile.model}</span>}
          </div>
        </>
      )}
      <fieldset className="quick-preferences" disabled={busy}>
        <legend className="visually-hidden">{t('Viewing controls')}</legend>
        <div className="quick-fields">
          {(['sourceLanguage', 'targetLanguage'] as const).map((name) => (
            <label key={name}>
              {t(
                name === 'sourceLanguage'
                  ? 'Source language'
                  : 'Target language',
              )}
              <input
                aria-label={t(
                  name === 'sourceLanguage'
                    ? 'Source language'
                    : 'Target language',
                )}
                value={draft[name]}
                maxLength={35}
                list={`${name}-quick`}
                onChange={(e) => {
                  dirty.current = true;
                  setEdited(true);
                  setDraft({ ...draft, [name]: e.target.value });
                }}
              />
              <datalist id={`${name}-quick`}>
                {(name === 'sourceLanguage'
                  ? [
                      'auto',
                      'en',
                      'tr',
                      'de',
                      'fr',
                      'es',
                      'ar',
                      'he',
                      'ja',
                      'ko',
                      'zh-CN',
                    ]
                  : [
                      'tr',
                      'en',
                      'de',
                      'fr',
                      'es',
                      'ar',
                      'he',
                      'ja',
                      'ko',
                      'zh-CN',
                    ]
                ).map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
            </label>
          ))}
          <label>
            {t('Display mode')}
            <select
              aria-label={t('Display mode')}
              value={draft.displayMode}
              onChange={(e) => {
                dirty.current = true;
                setEdited(true);
                setDraft({
                  ...draft,
                  displayMode: e.target.value as Settings['displayMode'],
                });
              }}
            >
              <option value="translated">{t('Translation only')}</option>
              <option value="bilingual">{t('Original and translation')}</option>
              <option value="original">{t('Original only')}</option>
            </select>
          </label>
        </div>
        <button
          className="text-button"
          type="button"
          onClick={() => void run(save)}
        >
          {t('Save preferences')}
        </button>
      </fieldset>
      <div
        className={
          showCaptions ? 'caption-section' : 'caption-section is-hidden'
        }
      >
        <div
          className={`playback-summary ${attention || restart ? 'needs-attention' : isOn ? 'is-on' : 'is-off'}`}
          role="status"
        >
          <strong>
            <span className="live-dot" aria-hidden="true" />
            {t(title)}
          </strong>
          <p>{t(summary)}</p>
          {data.recent?.durationMs !== null &&
            data.recent?.durationMs !== undefined &&
            !warning && (
              <p className="response-time">
                {t('Last request (queue + provider)')}:{' '}
                {data.recent.durationMs < 1000
                  ? `${data.recent.durationMs} ms`
                  : `${(data.recent.durationMs / 1000).toFixed(1)} s`}
              </p>
            )}
          {missingKey && (
            <p>
              {t(
                'Session keys disappear after Reload. Add the key again; choose Remember on this device to keep it.',
              )}
            </p>
          )}
        </div>
        {(data.youtube || state === 'source-required') &&
          (!isOn || restart || attention) && (
            <label className="source-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                {t(
                  'For YouTube: I selected an original caption track, not Auto-translate.',
                )}
              </span>
            </label>
          )}
        <div className="popup-controls">
          <button
            disabled={busy || (isOn && !restart && !attention)}
            className={isOn && !restart && !attention ? 'enabled-button' : ''}
            aria-pressed={isOn && !restart && !attention}
            type="button"
            onClick={() =>
              missingKey
                ? void browser.runtime.openOptionsPage()
                : control('playback.enable')
            }
          >
            {import.meta.env.MODE === 'mock'
              ? locale === 'tr'
                ? 'Test altyazısını etkinleştir'
                : 'Enable mock captions'
              : t(
                  missingKey
                    ? 'Add API key'
                    : restart
                      ? 'Restart captions'
                      : isOn && !attention
                        ? '✓ Enabled'
                        : 'Enable captions',
                )}
          </button>
          <button
            disabled={
              busy || (state !== 'enabled' && state !== 'needs-restart')
            }
            className="secondary"
            type="button"
            onClick={() => control('playback.disable')}
          >
            {t('Disable captions')}
          </button>
        </div>
      </div>
    </>
  );
}
