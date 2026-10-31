// Languages offered in pickers, as [code, native name]. Codes follow Google
// Translate; AI providers receive the same codes. Users can still type any
// valid code in the language fields.
export const LANGUAGES: readonly (readonly [string, string])[] = [
  ['en', 'English'],
  ['tr', 'Türkçe'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
  ['nl', 'Nederlands'],
  ['pl', 'Polski'],
  ['sv', 'Svenska'],
  ['cs', 'Čeština'],
  ['ro', 'Română'],
  ['hu', 'Magyar'],
  ['el', 'Ελληνικά'],
  ['ru', 'Русский'],
  ['uk', 'Українська'],
  ['ar', 'العربية'],
  ['he', 'עברית'],
  ['fa', 'فارسی'],
  ['ur', 'اردو'],
  ['hi', 'हिन्दी'],
  ['bn', 'বাংলা'],
  ['id', 'Bahasa Indonesia'],
  ['ms', 'Bahasa Melayu'],
  ['vi', 'Tiếng Việt'],
  ['th', 'ไทย'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
];

export const LANGUAGE_CODES: readonly string[] = LANGUAGES.map(
  ([code]) => code,
);

export function languageName(code: string): string {
  return LANGUAGES.find(([known]) => known === code)?.[1] ?? code;
}

// Maps regional and legacy codes to the provider codes above.
export function normalizeLanguage(value: string): string {
  const code = value.toLowerCase();
  return ['zh-tw', 'zh-hant', 'zh-hk'].includes(code)
    ? 'zh-TW'
    : ['zh', 'zh-cn', 'zh-hans'].includes(code)
      ? 'zh-CN'
      : code === 'iw'
        ? 'he'
        : code === 'in'
          ? 'id'
          : (code.split('-')[0] ?? '');
}
