import { sendRequest } from '../messaging/client';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { browser } from 'wxt/browser';
import { translate, type Locale } from './strings';
import { LanguageContext as Context } from './useI18n';
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void sendRequest({ type: 'settings.read' })
        .then((data) => {
          // Trusted UI reads only a presentation preference, never credentials.
          const saved = data.kind === 'settings' ? data.settings : null;
          if (active)
            setLocale(
              saved &&
                typeof saved === 'object' &&
                'uiLanguage' in saved &&
                saved.uiLanguage === 'tr'
                ? 'tr'
                : 'en',
            );
        })
        .catch(() => {});
    };
    const changed = (items: Record<string, unknown>) => {
      if ('settings.v1' in items || 'trusted-state-change' in items) refresh();
    };
    refresh();
    browser.storage.onChanged.addListener(changed);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(changed);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = 'ltr';
  }, [locale]);
  const t = useCallback((text: string) => translate(text, locale), [locale]);
  const value = useMemo(() => ({ locale, t }), [locale, t]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
