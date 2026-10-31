import { SelectionSettings } from '../../src/ui/SelectionSettings';
import { useState } from 'react';
import { browser } from 'wxt/browser';
import { sendRequest } from '../../src/messaging/client';
import { ViewingControls } from '../../src/ui/ViewingControls';
import { SiteSettings } from '../../src/ui/SiteSettings';
import { AISettings } from '../../src/ui/AISettings';
import { CloudSettings } from '../../src/ui/CloudSettings';
import { GoogleSettings } from '../../src/ui/GoogleSettings';
import { CacheSettings } from '../../src/ui/CacheSettings';
import { DevelopmentNotice } from '../../src/ui/DevelopmentNotice';
import { useI18n } from '../../src/ui/useI18n';
export function App() {
  const { t } = useI18n();
  const [status, setStatus] = useState('');
  async function exportSettings() {
    try {
      const data = await sendRequest({ type: 'settings.export' });
      if (data.kind !== 'export') throw new Error();
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
      setStatus('Could not export preferences.');
    }
  }
  return (
    <main className="options">
      <nav className="topbar" aria-label="Subtitle studio">
        <div className="brand">
          <img src="/icons/icon-48.png" width="40" height="40" alt="" />
          <span>
            Subtitle<span className="brand-light"> / studio</span>
          </span>
        </div>
        <span className="build-badge">
          <span className="status-dot" />
          {t('Limited preview')}
        </span>
      </nav>
      <header className="page-heading">
        <h1>{t('Small details. A better view.')}</h1>
        <p className="intro">
          {t('Set the look of your captions. Keep your focus on the story.')}
        </p>
      </header>
      <div className="settings-grid">
        <div className="preview-column">
          <ViewingControls />
          <SelectionSettings />
          <button
            type="button"
            className="secondary"
            onClick={() => void exportSettings()}
          >
            {t('Export saved preferences')}
          </button>
          {status && <p role="status">{t(status)}</p>}
        </div>
        <aside className="preview-column">
          {import.meta.env.MODE !== 'mock' && <SiteSettings />}
          <DevelopmentNotice />
        </aside>
      </div>
      {import.meta.env.MODE !== 'mock' && (
        <details className="api-settings glass-panel">
          <summary>{t('API keys and privacy')}</summary>
          <p>
            {t(
              'Configure your provider account, saved keys and translation cache.',
            )}
          </p>
          <div className="settings-grid">
            <div className="preview-column">
              <AISettings />
              <CloudSettings />
            </div>
            <div className="preview-column">
              <GoogleSettings />
              <CacheSettings />
            </div>
          </div>
        </details>
      )}
      <footer className="settings-footer">
        <span>AI Live Subtitle Translator</span>
        <span>
          {t('Version')}{' '}
          {browser.runtime.getManifest().version_name ??
            browser.runtime.getManifest().version}
        </span>
      </footer>
    </main>
  );
}
