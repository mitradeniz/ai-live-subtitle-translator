import { lazy, Suspense } from 'react';
import { browser } from 'wxt/browser';
import { useI18n } from '../../src/ui/useI18n';
const PopupDashboard = lazy(() => import('../../src/ui/PopupDashboard'));

export function App() {
  const { t } = useI18n();
  return (
    <main className="popup dashboard-popup">
      <header className="popup-brand">
        <img src="/icons/icon-32.png" width="32" height="32" alt="" />
        <div>
          <h1>{t('Subtitles, in your language.')}</h1>
          <span className="preview-label">{t('Limited preview')}</span>
        </div>
      </header>
      <Suspense fallback={<p role="status">{t('Loading preferences…')}</p>}>
        <PopupDashboard />
      </Suspense>
      <footer className="popup-footer">
        <button
          className="secondary"
          type="button"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          {t('Open settings')} <span aria-hidden="true">↗</span>
        </button>
        <span>
          {browser.runtime.getManifest().version_name ??
            browser.runtime.getManifest().version}
        </span>
      </footer>
    </main>
  );
}
