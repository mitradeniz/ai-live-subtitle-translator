import { browser } from 'wxt/browser';
import { DevelopmentNotice } from '../../src/ui/DevelopmentNotice';

export function App() {
  return (
    <main className="options">
      <header>
        <p className="eyebrow">AI Live Subtitle Translator</p>
        <h1>Settings</h1>
        <p className="intro">This is an early development build.</p>
      </header>
      <DevelopmentNotice />
      <section aria-labelledby="settings-status">
        <h2 id="settings-status">No settings to configure yet</h2>
        <p>
          This build does not read video captions, store API keys, or contact
          translation services. There is nothing to connect or enable.
        </p>
      </section>
      <footer className="footnote">
        Version {browser.runtime.getManifest().version} · Local development
        build
      </footer>
    </main>
  );
}
