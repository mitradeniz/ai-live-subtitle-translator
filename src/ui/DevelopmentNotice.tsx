import { useI18n } from './useI18n';
export function DevelopmentNotice() {
  const { t, locale } = useI18n();
  return (
    <section className="notice" aria-label={t('Development status')}>
      <p className="status">
        {import.meta.env.MODE === 'mock'
          ? locale === 'tr'
            ? 'MOCK · Test sürümü'
            : 'MOCK · Test build'
          : t('Early development')}
      </p>
      <p>
        {import.meta.env.MODE === 'mock'
          ? locale === 'tr'
            ? 'Bu test sürümü altyazıları [MOCK] önekiyle tekrarlar. Çeviri yapmaz.'
            : 'This test build repeats available captions with a [MOCK] prefix. It does not translate.'
          : t(
              'Caption support is experimental. Choose Google or your own AI provider in settings.',
            )}
      </p>
    </section>
  );
}
