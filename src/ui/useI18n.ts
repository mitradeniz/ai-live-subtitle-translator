import { createContext, useContext } from 'react';
import type { Locale } from './strings';
export const LanguageContext = createContext({
  locale: 'en' as Locale,
  t: (text: string) => text,
});
export const useI18n = () => useContext(LanguageContext);
