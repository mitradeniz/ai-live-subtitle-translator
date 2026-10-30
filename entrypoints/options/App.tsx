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
      <nav className="topbar" aria-label="Settings header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◫
          </span>
          <span>
            Subtitle<span className="brand-light"> / studio</span>
          </span>
        </div>
        <span className="build-badge">
          <span className="status-dot" /> Early development
        </span>
      </nav>
      <header className="page-heading">
        <p className="eyebrow">YOUR VIEWING SPACE</p>
        <h1>
          Small details.
          <br />
          <span>A better view.</span>
        </h1>
        <p className="intro">
          Set the look of your captions. Keep your focus on the story.
        </p>
      </header>
      <div className="settings-grid">
        <section
          className="glass-panel preferences-panel"
          aria-labelledby="settings-status"
        >
          <div className="panel-heading">
            <span className="panel-icon" aria-hidden="true">
              Aa
            </span>
            <div>
              <h2 id="settings-status">Subtitle preferences</h2>
              <p>Make the reading experience yours.</p>
            </div>
          </div>
          {!settings && !error && <p role="status">Loading preferences…</p>}
          {settings && (
            <form onSubmit={(event) => void save(event)}>
              <fieldset disabled={busy}>
                <legend className="visually-hidden">
                  Subtitle preferences
                </legend>
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
                <p id="language-help" className="field-help">
                  Language code, such as tr, en, or pt-BR. Saved for future
                  translation.
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
                <p className="field-help">
                  Original captions remain visible while translation is
                  unavailable.
                </p>
                <label>
                  Font size
                  <div className="input-unit">
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
                    <span aria-hidden="true">px</span>
                  </div>
                </label>
                <div className="actions">
                  <button type="submit">
                    Save preferences <span aria-hidden="true">↗</span>
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => void exportSettings()}
                  >
                    Export saved preferences
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          {status && (
            <p role="status" className="feedback">
              {status}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
        <aside className="preview-column">
          <section
            className="glass-panel preview-panel"
            aria-labelledby="preview-title"
          >
            <div className="preview-heading">
              <h2 id="preview-title">A quiet preview</h2>
              <span className="tiny-label">APPEARANCE ONLY</span>
            </div>
            <div className="caption-preview">
              <div className="preview-orbit" aria-hidden="true" />
              <div className="preview-horizon" aria-hidden="true" />
              <p
                className="preview-caption"
                style={{
                  fontSize: Number.isFinite(settings?.fontSize)
                    ? settings?.fontSize
                    : 24,
                }}
              >
                A little closer to every story.
              </p>
            </div>
            <p className="field-help">
              Sample text. Save, then re-enable captions on the video page to
              apply changes.
            </p>
          </section>
          <DevelopmentNotice />
          <div className="privacy-note">
            <span aria-hidden="true">◇</span>
            <p>
              Your preferences stay on this device.
              <br />
              Exports never include API keys.
            </p>
          </div>
        </aside>
      </div>
      <footer className="settings-footer">
        <span>AI Live Subtitle Translator</span>
        <span>
          Version {browser.runtime.getManifest().version} · Local development
        </span>
      </footer>
    </main>
  );
}
