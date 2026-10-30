import { useState } from 'react';
import { browser } from 'wxt/browser';
import { DevelopmentNotice } from '../../src/ui/DevelopmentNotice';
import type { PlaybackOperation } from '../../src/messaging/playback';

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(
    'Choose a video page, then enable captions.',
  );
  const [busy, setBusy] = useState(false);

  async function control(type: PlaybackOperation) {
    setBusy(true);
    setError(null);
    try {
      const { sendRequest } = await import('../../src/messaging/client');
      const data = await sendRequest({ type });
      if (data.kind !== 'playback') throw new Error('Unexpected response');
      const messages = {
        enabled: 'Caption overlay enabled. Waiting for accessible native cues.',
        disabled: 'Caption overlay is off. Native caption state restored.',
        'no-video': 'No visible HTML5 video found in the main page.',
        unavailable:
          import.meta.env.MODE === 'mock'
            ? 'Open the local fixture at http://127.0.0.1:4173, then try again.'
            : 'Access unavailable. Open a regular video webpage and click the extension again.',
      };
      setStatus(messages[data.state]);
    } catch {
      setError('Could not change captions. Reload the page and try again.');
    } finally {
      setBusy(false);
    }
  }

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
      <div className="popup-controls">
        <button
          disabled={busy}
          type="button"
          onClick={() => void control('playback.enable')}
        >
          {import.meta.env.MODE === 'mock'
            ? 'Enable mock captions'
            : 'Enable native captions'}
        </button>
        <button
          disabled={busy}
          className="secondary"
          type="button"
          onClick={() => void control('playback.disable')}
        >
          Disable captions
        </button>
      </div>
      <p className="popup-status" role="status">
        {status}
      </p>
      <button
        className="secondary"
        type="button"
        onClick={() => void openOptions()}
      >
        Open settings <span aria-hidden="true">↗</span>
      </button>
      {error && <p role="alert">{error}</p>}
      <p className="footnote">
        Version {browser.runtime.getManifest().version}
      </p>
    </main>
  );
}
