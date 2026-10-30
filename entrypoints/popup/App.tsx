import { useState } from 'react';
import { browser } from 'wxt/browser';
import { DevelopmentNotice } from '../../src/ui/DevelopmentNotice';

export function App() {
  const [error, setError] = useState<string | null>(null);

  async function openOptions() {
    setError(null);
    try {
      await browser.runtime.openOptionsPage();
    } catch {
      setError('Could not open settings. Try the extension’s Details page.');
    }
  }

  return (
    <main className="popup">
      <p className="eyebrow">AI Live Subtitle Translator</p>
      <h1>Subtitles, in your language.</h1>
      <DevelopmentNotice />
      <button type="button" onClick={() => void openOptions()}>
        Open settings <span aria-hidden="true">↗</span>
      </button>
      {error && <p role="alert">{error}</p>}
      <p className="footnote">
        Version {browser.runtime.getManifest().version}
      </p>
    </main>
  );
}
