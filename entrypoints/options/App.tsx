import { browser } from 'wxt/browser';
import { useEffect, useState, type FormEvent } from 'react';
import { sendRequest } from '../../src/messaging/client';
import type { Settings } from '../../src/messaging/protocol';
import { DevelopmentNotice } from '../../src/ui/DevelopmentNotice';

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    void sendRequest({ type: 'settings.read' })
      .then((data) => {
        if (data.kind !== 'settings') throw new Error('Unexpected response');
        if (active) setSettings(data.settings);
      })
      .catch(() => {
        if (active)
          setError(
            'Settings are unavailable. Reload the extension and try again.',
          );
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      const { sourceLanguage, targetLanguage, displayMode, fontSize } =
        settings;
      const data = await sendRequest({
        type: 'settings.update',
        preferences: { sourceLanguage, targetLanguage, displayMode, fontSize },
      });
      if (data.kind !== 'settings') throw new Error('Unexpected response');
      setSettings(data.settings);
      setStatus('Preferences saved. Translation is not available yet.');
    } catch {
      setError('Could not save preferences. No translation has been enabled.');
    } finally {
      setBusy(false);
    }
  }

  async function exportSettings() {
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      const data = await sendRequest({ type: 'settings.export' });
      if (data.kind !== 'export') throw new Error('Unexpected response');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data.exported, null, 2)], {
          type: 'application/json',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'subtitle-translator-settings.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus('Saved preferences exported without API keys.');
    } catch {
      setError('Could not export preferences.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="options">
      <header>
        <p className="eyebrow">AI Live Subtitle Translator</p>
        <h1>Settings</h1>
        <p className="intro">This is an early development build.</p>
      </header>
      <DevelopmentNotice />
      <section aria-labelledby="settings-status">
        <h2 id="settings-status">Subtitle preferences</h2>
        <p>
          Save your preferences for later. This build does not read captions or
          contact translation services.
        </p>
        {!settings && !error && <p role="status">Loading preferences…</p>}
        {settings && (
          <form onSubmit={(event) => void save(event)}>
            <fieldset disabled={busy}>
              <legend className="visually-hidden">Subtitle preferences</legend>
              <label>
                Target language
                <input
                  value={settings.targetLanguage}
                  maxLength={35}
                  required
                  aria-describedby="language-help"
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      targetLanguage: event.target.value,
                    })
                  }
                />
              </label>
              <p id="language-help" className="footnote">
                Language code, such as tr, en, or pt-BR.
              </p>
              <label>
                Display mode
                <select
                  value={settings.displayMode}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (
                      value === 'bilingual' ||
                      value === 'translated' ||
                      value === 'original'
                    )
                      setSettings({ ...settings, displayMode: value });
                  }}
                >
                  <option value="bilingual">Original and translation</option>
                  <option value="translated">Translation only</option>
                  <option value="original">Original only</option>
                </select>
              </label>
              <label>
                Font size
                <input
                  type="number"
                  min={16}
                  max={48}
                  step={1}
                  required
                  value={
                    Number.isNaN(settings.fontSize) ? '' : settings.fontSize
                  }
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      fontSize: event.target.valueAsNumber,
                    })
                  }
                />
              </label>
              <div className="actions">
                <button type="submit">Save preferences</button>
                <button type="button" onClick={() => void exportSettings()}>
                  Export saved preferences
                </button>
              </div>
            </fieldset>
          </form>
        )}
        {status && <p role="status">{status}</p>}
        {error && <p role="alert">{error}</p>}
        <p className="footnote">
          API-key setup is not available in this build.
        </p>
      </section>
      <footer className="footnote">
        Version {browser.runtime.getManifest().version} · Local development
        build
      </footer>
    </main>
  );
}
