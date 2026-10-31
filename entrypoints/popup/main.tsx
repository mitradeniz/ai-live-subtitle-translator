import { LanguageProvider } from '../../src/ui/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../../src/ui/styles.css';
import { trackSpecular } from '../../src/ui/specular';

const root = document.getElementById('root');
if (!root) throw new Error('Popup root element is missing.');

trackSpecular();
createRoot(root).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
);
