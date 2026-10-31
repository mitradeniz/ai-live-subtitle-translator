import { lazy, Suspense, useState } from 'react';
import { useI18n } from '../../src/ui/useI18n';
const ViewingControls = lazy(() =>
  import('../../src/ui/ViewingControls').then((module) => ({
    default: module.ViewingControls,
  })),
);
import { browser } from 'wxt/browser';
import { DevelopmentNotice } from '../../src/ui/DevelopmentNotice';
import type { PlaybackOperation } from '../../src/messaging/playback';

export function App() {
  const { t, locale } = useI18n();
  const [showControls, setShowControls] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(
    'Choose a video page, then enable captions.',
  );
  const [busy, setBusy] = useState(false);
  const [youtubeSourceConfirmed, setYouTubeSourceConfirmed] = useState(false);

  async function control(type: PlaybackOperation) {
    setBusy(true);
    setError(null);
    try {
      const { sendRequest } = await import('../../src/messaging/client');
      const data = await sendRequest(
        type === 'playback.enable'
          ? { type, youtubeSourceConfirmed }
          : { type },
      );
      if (data.kind !== 'playback') throw new Error('Unexpected response');
      const messages = {
        enabled:
          'Caption overlay enabled. Waiting for accessible caption text.',
        disabled: 'Caption overlay is off. Native caption state restored.',
        'no-video': 'No visible HTML5 video found in the main page.',
        'source-required':
          'Select a source caption track in YouTube, then confirm your selection.',
        unavailable:
          import.meta.env.MODE === 'mock'
            ? 'Open the local fixture or a YouTube watch page, then try again.'
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
      <div className="popup-brand">
        <img src="/icons/icon-32.png" width="32" height="32" alt="" />
        <p className="eyebrow">AI Live Subtitle Translator</p>
      </div>
      <h1>{t('Subtitles, in your language.')}</h1>
      <DevelopmentNotice />
      <label className="source-confirm">
        <input
          type="checkbox"
          checked={youtubeSourceConfirmed}
          onChange={(event) => setYouTubeSourceConfirmed(event.target.checked)}
        />
        <span>
          {t(
            'For YouTube: I selected an original caption track, not Auto-translate.',
          )}
        </span>
      </label>
      <div className="popup-controls">
        <button
          disabled={busy}
          type="button"
          onClick={() => void control('playback.enable')}
        >
          {import.meta.env.MODE === 'mock'
            ? locale === 'tr'
              ? 'Test altyazısını etkinleştir'
              : 'Enable mock captions'
            : t('Enable captions')}
        </button>
        <button
          disabled={busy}
          className="secondary"
          type="button"
          onClick={() => void control('playback.disable')}
        >
          {t('Disable captions')}
        </button>
      </div>
      <p className="popup-status" role="status">
        {t(status)}
      </p>
      <details
        className="popup-details"
        onToggle={(event) => setShowControls(event.currentTarget.open)}
      >
        <summary>{t('Viewing controls')}</summary>
        {showControls && (
          <Suspense fallback={<p>{t('Loading preferences…')}</p>}>
            <ViewingControls compact />
          </Suspense>
        )}
      </details>
      <button
        className="secondary"
        type="button"
        onClick={() => void openOptions()}
      >
        {t('Open settings')} <span aria-hidden="true">↗</span>
      </button>
      {error && <p role="alert">{t(error)}</p>}
      <p className="footnote">
        {t('Version')}{' '}
        {browser.runtime.getManifest().version_name ??
          browser.runtime.getManifest().version}
      </p>
    </main>
  );
}
