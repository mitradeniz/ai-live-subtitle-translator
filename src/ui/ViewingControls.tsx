import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendRequest } from '../messaging/client';
import type { Settings } from '../messaging/protocol';
import { useI18n } from './useI18n';
type Engine = 'none' | 'google' | 'google-cloud' | 'ai';
const engines = {
  none: 'Original captions only',
  google: 'Google · Experimental · No key',
  'google-cloud': 'Google Cloud · Your key · Provider billing',
  ai: 'AI · Your key and model',
};
export function ViewingControls({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [engine, setEngine] = useState<Engine>('none');
  const [aiHost, setAIHost] = useState('https://api.openai.com/*');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    const load = () => {
      void Promise.all([
        sendRequest({ type: 'settings.read' }),
        sendRequest({ type: 'controls.read' }),
      ])
        .then(([s, p]) => {
          if (!active) return;
          if (s.kind === 'settings') setSettings(s.settings);
          if (p.kind === 'controls') {
            setEngine(p.selected);
            setAIHost(p.aiHost);
          }
        })
        .catch(() => {
          if (active) setMessage('Provider status unavailable.');
        });
    };
    const changed = (items: Record<string, unknown>) => {
      if (
        ['settings.v1', 'translation-provider.v1', 'ai-profile.v1'].some(
          (k) => k in items,
        )
      )
        load();
    };
    load();
    browser.storage.onChanged.addListener(changed);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(changed);
    };
  }, []);
  async function save() {
    if (!settings) return;
    setBusy(true);
    try {
      const { schemaVersion, ...preferences } = settings;
      void schemaVersion;
      await sendRequest({ type: 'controls.update', preferences });
      setMessage('Preferences saved.');
    } catch {
      setMessage('Could not save preferences.');
    } finally {
      setBusy(false);
    }
  }
  function selectEngine() {
    const host =
      engine === 'google'
        ? 'https://translate.googleapis.com/*'
        : engine === 'google-cloud'
          ? 'https://translation.googleapis.com/*'
          : aiHost;
    const grant =
      engine === 'none'
        ? Promise.resolve(true)
        : browser.permissions.request({ origins: [host] });
    setBusy(true);
    void grant
      .then(async (allowed) => {
        if (!allowed) {
          setMessage(
            'Access was not granted. Your current engine is unchanged.',
          );
          return;
        }
        await sendRequest({ type: 'controls.select', provider: engine });
        setMessage(
          'Engine selected. Re-enable captions from the video page popup. No test was sent.',
        );
      })
      .catch(() =>
        setMessage(
          'Could not select engine. Check saved profile and permission.',
        ),
      )
      .finally(() => setBusy(false));
  }
  if (!settings) return <p role="status">{t('Loading preferences…')}</p>;
  const language = (
    name: 'sourceLanguage' | 'targetLanguage',
    title: string,
  ) => (
    <label>
      {t(title)}
      <input
        aria-label={t(title)}
        value={settings[name]}
        maxLength={35}
        list={
          name === 'sourceLanguage' ? 'source-languages' : 'target-languages'
        }
        onChange={(event) =>
          setSettings({ ...settings, [name]: event.target.value })
        }
      />
    </label>
  );
  return (
    <section
      className={
        compact ? 'viewing-controls compact' : 'glass-panel preferences-panel'
      }
      aria-label={t('Viewing controls')}
    >
      <h2>{t('Subtitle preferences')}</h2>
      {!compact && <CaptionPreview settings={settings} />}
      <fieldset disabled={busy}>
        <legend className="visually-hidden">{t('Viewing controls')}</legend>
        <div className="paired-fields">
          {language('sourceLanguage', 'Source language')}
          {language('targetLanguage', 'Target language')}
        </div>
        <datalist id="source-languages">
          <option value="auto">{t('Auto-detect')}</option>
          {['en', 'tr', 'de', 'fr', 'es', 'ar', 'he', 'ja', 'ko', 'zh-CN'].map(
            (code) => (
              <option key={code} value={code} />
            ),
          )}
        </datalist>
        <datalist id="target-languages">
          {['tr', 'en', 'de', 'fr', 'es', 'ar', 'he', 'ja', 'ko', 'zh-CN'].map(
            (code) => (
              <option key={code} value={code} />
            ),
          )}
        </datalist>
        {!compact && (
          <p className="field-help">
            {t('Language codes such as en, tr, ar or he.')}
          </p>
        )}
        <label>
          {t('Display mode')}
          <select
            aria-label={t('Display mode')}
            value={settings.displayMode}
            onChange={(e) =>
              setSettings({
                ...settings,
                displayMode: e.target.value as Settings['displayMode'],
              })
            }
          >
            <option value="bilingual">{t('Original and translation')}</option>
            <option value="translated">{t('Translation only')}</option>
            <option value="original">{t('Original only')}</option>
          </select>
        </label>
        <div className="paired-fields">
          <label>
            {t('Font size')}
            <input
              aria-label={t('Font size')}
              type="number"
              min={16}
              max={48}
              value={Number.isNaN(settings.fontSize) ? '' : settings.fontSize}
              onChange={(e) =>
                setSettings({ ...settings, fontSize: e.target.valueAsNumber })
              }
            />
          </label>
          <label>
            {t('Contrast')}
            <select
              aria-label={t('Contrast')}
              value={settings.contrast}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  contrast: e.target.value as Settings['contrast'],
                })
              }
            >
              <option value="glass">{t('Glass')}</option>
              <option value="solid">{t('Solid background')}</option>
            </select>
          </label>
        </div>
        <div className="paired-fields">
          <label>
            {t('Position')}
            <select
              aria-label={t('Position')}
              value={settings.position}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  position: e.target.value as Settings['position'],
                })
              }
            >
              <option value="bottom">{t('Bottom')}</option>
              <option value="top">{t('Top')}</option>
            </select>
          </label>
          <label>
            {t('Interface language')}
            <select
              aria-label={t('Interface language')}
              value={settings.uiLanguage}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  uiLanguage: e.target.value as Settings['uiLanguage'],
                })
              }
            >
              <option value="en">English</option>
              <option value="tr">Türkçe</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="save-controls"
          onClick={() => void save()}
        >
          {t('Save preferences')}
        </button>
        <p className="field-help">
          {t('Language changes require enabling captions again.')}
        </p>
        {import.meta.env.MODE !== 'mock' && (
          <div className="engine-controls">
            <label>
              {t('Engine')}
              <select
                aria-label={t('Engine')}
                value={engine}
                onChange={(e) => setEngine(e.target.value as Engine)}
              >
                {Object.entries(engines).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="secondary" onClick={selectEngine}>
              {t('Apply engine')}
            </button>
          </div>
        )}
      </fieldset>
      {message && (
        <p className="feedback" role="status">
          {t(message)}
        </p>
      )}
    </section>
  );
}

// Sample lines for the live preview only; nothing here is sent anywhere.
const PREVIEW_ORIGINAL = 'We kept walking until the city lights disappeared.';
const PREVIEW_TRANSLATIONS: Record<string, string> = {
  tr: 'Şehrin ışıkları kaybolana dek yürümeye devam ettik.',
  de: 'Wir gingen weiter, bis die Lichter der Stadt verschwanden.',
  fr: 'Nous avons marché jusqu’à ce que les lumières de la ville disparaissent.',
  es: 'Seguimos caminando hasta que las luces de la ciudad desaparecieron.',
};
function CaptionPreview({ settings }: { settings: Settings }) {
  const size = Number.isFinite(settings.fontSize)
    ? Math.min(48, Math.max(16, settings.fontSize))
    : 24;
  const [target = ''] = settings.targetLanguage.trim().toLowerCase().split('-');
  const translated = PREVIEW_TRANSLATIONS[target] ?? PREVIEW_ORIGINAL;
  const original = settings.displayMode !== 'translated';
  const translation = settings.displayMode !== 'original';
  return (
    <div className="caption-preview" aria-hidden="true">
      <span className="preview-size">{size} px</span>
      <div
        className={`preview-stage ${settings.position === 'top' ? 'top' : ''}`}
      >
        <div
          className={`preview-caption ${settings.contrast === 'solid' ? 'solid' : ''}`}
          style={{ fontSize: `${Math.round(size * 0.62)}px` }}
        >
          {original && (
            <span className="preview-original">{PREVIEW_ORIGINAL}</span>
          )}
          {translation && <span>{translated}</span>}
        </div>
      </div>
    </div>
  );
}
