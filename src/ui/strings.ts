export type Locale = 'en' | 'tr';
export const turkish: Record<string, string> = {
  'Subtitles, in your language.': 'Altyazılar, senin dilinde.',
  'Subtitle preferences': 'Altyazı tercihleri',
  'Source language': 'Kaynak dil',
  'Target language': 'Hedef dil',
  'Auto-detect': 'Otomatik algıla',
  'Display mode': 'Görünüm',
  'Original and translation': 'Orijinal ve çeviri',
  'Translation only': 'Yalnızca çeviri',
  'Original only': 'Yalnızca orijinal',
  'Font size': 'Yazı boyutu',
  Contrast: 'Kontrast',
  Glass: 'Cam',
  'Solid background': 'Düz arka plan',
  Position: 'Konum',
  Bottom: 'Alt',
  Top: 'Üst',
  'Interface language': 'Arayüz dili',
  'Save preferences': 'Tercihleri kaydet',
  'Preferences saved.': 'Tercihler kaydedildi.',
  'Enable captions': 'Altyazıyı etkinleştir',
  'Disable captions': 'Altyazıyı kapat',
  'Open settings': 'Ayarları aç',
  'Choose a video page, then enable captions.':
    'Bir video sayfasında altyazıyı etkinleştir.',
  'Caption overlay enabled. Waiting for accessible caption text.':
    'Altyazı açık. Erişilebilir altyazı metni bekleniyor.',
  'Caption overlay is off. Native caption state restored.':
    'Altyazı kapalı. Videonun önceki altyazı durumu geri yüklendi.',
  'No visible HTML5 video found in the main page.':
    'Sayfada görünür bir video bulunamadı.',
  'Select a source caption track in YouTube, then confirm your selection.':
    'YouTube’da orijinal altyazıyı seçip aşağıdan onayla.',
  'Access unavailable. Open a regular video webpage and click the extension again.':
    'Erişim yok. Video sayfasında eklentiyi yeniden aç.',
  'Open the local fixture or a YouTube watch page, then try again.':
    'Yerel test veya YouTube video sayfasını açıp yeniden dene.',
  'Could not change captions. Reload the page and try again.':
    'Altyazı değiştirilemedi. Sayfayı yenileyip yeniden dene.',
  'Could not open settings. Try the extension’s Details page.':
    'Ayarlar açılamadı. Eklentinin Ayrıntılar sayfasını dene.',
  'For YouTube: I selected an original caption track, not Auto-translate.':
    'YouTube’da otomatik çeviri yerine orijinal altyazıyı seçtim.',
  'Viewing controls': 'Görünüm kontrolleri',
  'Translation engine': 'Çeviri motoru',
  Engine: 'Motor',
  'Original captions only': 'Yalnızca orijinal altyazı',
  'Google · Experimental · No key': 'Google · Deneysel · Anahtarsız',
  'Google Cloud · Your key · Provider billing':
    'Google Cloud · Kendi anahtarın · Ücretli kullanım',
  'AI · Your key and model': 'AI · Kendi anahtarın ve modelin',
  'Apply engine': 'Motoru seç',
  'Change the engine before enabling captions.':
    'Altyazıyı etkinleştirmeden önce motoru seç.',
  'Engine selected. Re-enable captions from the video page popup. No test was sent.':
    'Motor seçildi. Popup’tan altyazıyı yeniden etkinleştir. Test gönderilmedi.',
  'Access was not granted. Your current engine is unchanged.':
    'İzin verilmedi. Mevcut motor değişmedi.',
  'Could not select engine. Check saved profile and permission.':
    'Motor seçilemedi. Kayıtlı profili ve izni kontrol et.',
  'Provider status unavailable.': 'Sağlayıcı durumu alınamıyor.',
  'Language codes such as en, tr, ar or he.':
    'en, tr, ar veya he gibi dil kodları.',
  'Could not save preferences.': 'Tercihler kaydedilemedi.',
  'Language changes require enabling captions again.':
    'Dil değişikliğinden sonra altyazıyı yeniden etkinleştir.',
  'Small details. A better view.': 'Küçük detaylar. Daha iyi bir görünüm.',
  'Set the look of your captions. Keep your focus on the story.':
    'Altyazını kendine göre ayarla. Hikâyeye odaklan.',
  'API keys and privacy': 'API anahtarları ve gizlilik',
  'Configure your provider account, saved keys and translation cache.':
    'Sağlayıcı hesabını, kayıtlı anahtarları ve çeviri önbelleğini yönet.',
  'Automatic captions on YouTube': 'YouTube’da otomatik altyazı',
  'After you allow access, captions can start on YouTube watch pages without opening the extension. Text goes to your selected provider.':
    'Erişim izninden sonra YouTube video sayfalarında eklentiyi açmadan altyazı başlayabilir. Metin seçtiğin sağlayıcıya gönderilir.',
  'Use original YouTube captions; never Auto-translate.':
    'YouTube’da orijinal altyazıları kullan; otomatik çeviriyi kullanma.',
  'Allow YouTube and turn on': 'YouTube’a izin ver ve aç',
  'Turn off and remove access': 'Kapat ve erişimi kaldır',
  'Automatic captions are on.': 'Otomatik altyazı açık.',
  'Automatic captions are off.': 'Otomatik altyazı kapalı.',
  'YouTube access was not granted. You can try again.':
    'YouTube erişimi verilmedi. Yeniden deneyebilirsin.',
  'Could not update site access. Try again.':
    'Site erişimi güncellenemedi. Yeniden dene.',
  'Export saved preferences': 'Kayıtlı tercihleri dışa aktar',
  'Saved preferences exported without API keys.':
    'Tercihler API anahtarları olmadan dışa aktarıldı.',
  'Could not export preferences.': 'Tercihler dışa aktarılamadı.',
  'Caption controls': 'Altyazı kontrolleri',
  'Smaller text': 'Yazıyı küçült',
  'Larger text': 'Yazıyı büyüt',
  'Move captions': 'Altyazı konumunu değiştir',
  'Toggle contrast': 'Kontrastı değiştir',
  'Original captions': 'Orijinal altyazı',
  'Translation stopped. Open the extension popup and choose Enable captions again.':
    'Çeviri durdu. Eklenti popup’ından altyazıyı yeniden etkinleştir.',
  'Early development': 'Geliştirme aşamasında',
  Version: 'Sürüm',
  'Loading preferences…': 'Tercihler yükleniyor…',
};
export function translate(message: string, locale: Locale): string {
  if (locale !== 'tr') return message;
  const mapped = turkish[message.replace(/\s+/g, ' ').trim()];
  if (mapped)
    return (
      (message.startsWith(' ') ? ' ' : '') +
      mapped +
      (message.endsWith(' ') ? ' ' : '')
    );
  if (message.includes(' · '))
    return message
      .split(' · ')
      .map((part) => translate(part, locale))
      .join(' · ');
  if (message.startsWith('Captions sent to '))
    return `Altyazıların gönderildiği yer: ${message.slice(17)}`;
  const selected = message.match(
    /^(OpenAI|DeepSeek|Gemini) selected\. Other engines are inactive\. Re-enable captions on the video page\.$/,
  );
  if (selected)
    return `${selected[1]} seçildi. Video sayfasında altyazıyı yeniden etkinleştir.`;
  return message;
}

Object.assign(turkish, {
  '. AI is': '. AI durumu:',
  '. Cloud is': '. Cloud durumu:',
  '; host access is': '; erişim izni:',
  '. No audio, video or website cookies are sent.':
    '. Ses, video veya site çerezleri gönderilmez.',
  '. No audio, video or website cookies. No AI prompt context.':
    '. Ses, video, site çerezi veya AI bağlamı gönderilmez.',
  'AI disabled and selected provider access removed. Saved key retained until you delete it.':
    'AI kapatıldı ve sağlayıcı erişimi kaldırıldı. Anahtar sen silene kadar saklanır.',
  'AI profile': 'AI profili',
  'AI provider': 'AI sağlayıcısı',
  'AI settings unavailable. Save the supported profile to recover.':
    'AI ayarları alınamıyor. Desteklenen profili kaydedip yeniden dene.',
  'AI · Your API key': 'AI · Kendi API anahtarın',
  'API key': 'API anahtarı',
  'Access was not granted. Original captions remain available.':
    'Erişim izni verilmedi. Orijinal altyazılar kullanılabilir.',
  'Action failed. Check host access, extension errors and your Cloud configuration.':
    'İşlem başarısız. Erişim iznini ve Cloud ayarlarını kontrol et.',
  'Cache controls': 'Önbellek kontrolleri',
  'Cache settings unavailable.': 'Önbellek ayarları alınamıyor.',
  'Cache updated. Re-enable captions to continue.':
    'Önbellek güncellendi. Devam etmek için altyazıyı yeniden etkinleştir.',
  'Caption text and language choices go to':
    'Altyazı metni ve dil tercihleri şu adrese gönderilir:',
  'Clear translation cache': 'Çeviri önbelleğini temizle',
  'Cloud disabled and access removed. Saved key remains until deleted.':
    'Cloud kapatıldı ve erişim kaldırıldı. Anahtar silinene kadar saklanır.',
  'Cloud key deleted from session and device storage. Pending work stopped.':
    'Cloud anahtarı oturumdan ve cihazdan silindi. Bekleyen işlemler durduruldu.',
  'Cloud key saved without contacting Google. Re-enable captions after changes.':
    'Cloud anahtarı Google’a istek gönderilmeden kaydedildi. Altyazıyı yeniden etkinleştir.',
  'Could not complete this action. Check the profile, access permission and extension errors.':
    'İşlem tamamlanamadı. Profili ve erişim iznini kontrol et.',
  'Could not enable Google. Reload the extension and try again.':
    'Google etkinleştirilemedi. Eklentiyi yeniden yükleyip dene.',
  'Could not remove access. Use the extension’s Chrome site-access controls.':
    'Erişim kaldırılamadı. Chrome’un eklenti site erişimi ayarlarını kullan.',
  'Could not update cache. Check extension errors.':
    'Önbellek güncellenemedi. Eklenti hatalarını kontrol et.',
  'Default: session storage, cleared on browser restart or extension reload/update. Remembered keys survive restart until deleted; device storage is not encrypted by this extension. This checkbox applies when saving a new key.':
    'Varsayılan saklama oturumluktur; tarayıcı veya eklenti yeniden yüklendiğinde silinir. Hatırlanan anahtarlar sen silene kadar kalır. Eklenti cihazdaki veriyi şifrelemez. Bu seçenek yeni anahtar kaydedilirken uygulanır.',
  'Delete AI key': 'AI anahtarını sil',
  'Delete Cloud key': 'Cloud anahtarını sil',
  'Delete saved data and keys': 'Kayıtlı verileri ve anahtarları sil',
  'Development status': 'Geliştirme durumu',
  'Disable AI and remove access': 'AI’ı kapat ve erişimi kaldır',
  'Disable Cloud and remove access': 'Cloud’u kapat ve erişimi kaldır',
  'Disable Google and remove access': 'Google’ı kapat ve erişimi kaldır',
  'Enable experimental Google': 'Deneysel Google’ı etkinleştir',
  'Enabling sends caption text and language choices to':
    'Etkinleştirildiğinde altyazı metni ve dil tercihleri şu adrese gönderilir:',
  'Enter a key to save or replace it':
    'Kaydetmek veya değiştirmek için anahtar gir',
  'Google Cloud API key': 'Google Cloud API anahtarı',
  'Google Cloud access was not granted.': 'Google Cloud erişim izni verilmedi.',
  'Google Cloud credentials': 'Google Cloud anahtar bilgileri',
  'Google Cloud selected. Other engines are inactive. Re-enable captions on the video page.':
    'Google Cloud seçildi. Diğer motorlar kapalı. Video sayfasında altyazıyı yeniden etkinleştir.',
  'Google Cloud settings unavailable.': 'Google Cloud ayarları alınamıyor.',
  'Google Cloud · Your API key': 'Google Cloud · Kendi API anahtarın',
  'Google access status unavailable.': 'Google erişim durumu alınamıyor.',
  'Google disabled and access removed.':
    'Google kapatıldı ve erişimi kaldırıldı.',
  'Google enabled. AI is inactive. Re-enable captions on the video page.':
    'Google etkinleştirildi. AI kapalı. Video sayfasında altyazıyı yeniden etkinleştir.',
  'Google is': 'Google durumu:',
  'Google status unavailable.': 'Google durumu alınamıyor.',
  'Google · Experimental': 'Google · Deneysel',
  'Key deleted from session and device storage. Pending translation stopped.':
    'Anahtar oturumdan ve cihazdan silindi. Bekleyen çeviriler durduruldu.',
  'Local data deleted. Reopen settings to see defaults.':
    'Yerel veriler silindi. Varsayılanları görmek için ayarları yeniden aç.',
  Model: 'Model',
  'Native tracks and YouTube captions are experimental. Choose experimental Google, Google Cloud or AI in settings. Paid engines require your own key and explicit selection.':
    'Video ve YouTube altyazı desteği deneyseldir. Ayarlardan Google, Google Cloud veya AI seçebilirsin. Ücretli motorlar kendi anahtarını ve açık seçimini gerektirir.',
  'No API key or Google Cloud account. Uses an undocumented service that can change or stop working.':
    'API anahtarı veya Google Cloud hesabı gerekmez. Kullanılan belgelenmemiş hizmet değişebilir ya da durabilir.',
  'Official Translation Basic v2, billed to your Google Cloud project. Enable Cloud Translation API and billing in that project. This key is separate from Gemini and experimental keyless Google.':
    'Resmî Translation Basic v2; ücretler Google Cloud projenize yansır. Projede Cloud Translation API ve faturalandırmayı aç. Bu anahtar Gemini ve anahtarsız Google’dan ayrıdır.',
  'Optional device cache also holds at most 128 batches / 256 KiB. Translated text is not encrypted or anonymous. Expired entries are ignored and removed on access. No keys are cached.':
    'İsteğe bağlı cihaz önbelleği en fazla 128 grup / 256 KiB tutar. Çeviriler şifreli veya anonim değildir. Süresi dolan veriler kullanılmaz ve erişimde silinir. Anahtarlar önbelleğe alınmaz.',
  'Paid API usage on your own account. Caption text, language choices and up to four current cues as context go directly to':
    'API kullanımı kendi hesabına aittir. Altyazı metni, dil tercihleri ve en fazla dört satırlık bağlam doğrudan şu adrese gider:',
  'Provider access was not granted.': 'Sağlayıcı erişim izni verilmedi.',
  'Remember this new Cloud key on this device':
    'Bu yeni Cloud anahtarını cihazda hatırla',
  'Remember this new key on this device': 'Bu yeni anahtarı cihazda hatırla',
  'Remember translations for up to 24 hours on this device':
    'Çevirileri bu cihazda en fazla 24 saat hatırla',
  'Reviewed profiles only; no custom endpoints. Saving a different AI provider deletes the old origin-bound key. Enter a key for the selected provider. Save before enabling or testing.':
    'Yalnızca desteklenen profiller kullanılabilir. Farklı AI sağlayıcısı kaydedilince önceki adrese bağlı anahtar silinir. Seçili sağlayıcının anahtarını girip testten önce kaydet.',
  'Run small Cloud paid test': 'Küçük ücretli Cloud testi yap',
  'Run small paid test': 'Küçük ücretli test yap',
  'Save AI profile and key': 'AI profilini ve anahtarı kaydet',
  'Save Cloud key': 'Cloud anahtarını kaydet',
  'Save cache preference': 'Önbellek tercihini kaydet',
  'Saved key:': 'Kayıtlı anahtar:',
  'Saved without contacting the provider. Re-enable captions after changes.':
    'Sağlayıcıya istek gönderilmeden kaydedildi. Altyazıyı yeniden etkinleştir.',
  'Session storage by default: cleared on browser restart or extension reload/update. Remembered keys survive until deleted; device storage is not encrypted by this extension.':
    'Varsayılan saklama oturumluktur; tarayıcı veya eklenti yeniden yüklendiğinde silinir. Hatırlanan anahtarlar sen silene kadar kalır. Eklenti cihazdaki veriyi şifrelemez.',
  'Small Cloud test passed. Check actual translation quality during playback.':
    'Küçük Cloud testi geçti. Çeviri kalitesini oynatma sırasında kontrol et.',
  'Small test passed: The selected provider returned a valid response to the English-to-Turkish test. Check translation quality during playback.':
    'Küçük test geçti: sağlayıcı İngilizceden Türkçeye testine geçerli yanıt verdi. Çeviri kalitesini oynatma sırasında kontrol et.',
  'Supported HTTPS endpoint': 'Desteklenen HTTPS adresi',
  'Test: “Hello, world.” English-to-Turkish, only when clicked. At most one retry after an explicit rate-limit response; no automatic network retry or key test. Up to four 1,000-character cues/request, 10 requests/minute, 100/session. These limits are not a billing cap. Errors keep originals; fix the indicated issue or explicitly select another engine.':
    'Test, yalnızca tıklandığında “Hello, world.” metnini Türkçeye çevirir. Hız sınırı yanıtından sonra en fazla bir tekrar yapılır; bağlantı hatası veya anahtar otomatik denenmez. İstek başına dört adet 1.000 karakterlik satır, dakikada 10 ve oturumda 100 istek sınırı vardır. Bunlar harcama limiti değildir. Hatalarda orijinaller korunur.',
  'The test sends only “Hello, world.” to the saved AI provider. One retry is allowed after an explicit rate-limit response; network failures are not retried automatically. Saving or opening this page never tests a key. Up to 10 requests/minute, 100 per browser session, one at a time, 2,048 output tokens/request; no automatic provider fallback. These are request limits, not a billing cap. Check your provider’s pricing and account limits.':
    'Test yalnızca “Hello, world.” metnini kayıtlı AI sağlayıcısına gönderir. Hız sınırı yanıtından sonra bir tekrar yapılabilir; bağlantı hatası otomatik denenmez. Sayfayı açmak veya kaydetmek anahtarı test etmez. Dakikada 10, oturumda 100 istek ve istek başına 2.048 çıktı token sınırı vardır. Otomatik sağlayıcı değişimi yapılmaz. Bunlar harcama limiti değildir; sağlayıcının fiyat ve hesap sınırlarını kontrol et.',
  'Timed tracks may send up to 20 seconds of upcoming captions to the selected provider while playing. This can use quota for captions you skip. Visible YouTube captions have no lookahead.':
    'Zamanlı altyazılarda oynatma sırasında sıradaki en fazla 20 saniye sağlayıcıya gönderilebilir. Atladığın altyazılar da kota kullanabilir. Gözlenen YouTube altyazılarında ileri hazırlık yoktur.',
  'Translation cache': 'Çeviri önbelleği',
  'Translations stay in this browser session by default, up to 128 batches and 256 KiB, expiring after 30 minutes. Private browsing is unsupported.':
    'Çeviriler varsayılan olarak tarayıcı oturumunda tutulur: en fazla 128 grup / 256 KiB ve 30 dakika. Gizli gezinme desteklenmez.',
  'Up to 20 requests/minute, 200 per browser session; one request at a time. Errors keep original captions. Turning this off stops pending work and removes access. It cannot retract text already sent.':
    'Dakikada en fazla 20, oturumda 200 istek; aynı anda tek istek. Hatalarda orijinaller korunur. Kapatmak bekleyen işleri durdurur ve erişimi kaldırır. Gönderilen metin geri alınamaz.',
  Use: 'Kullan:',
  'Use Google Cloud for captions': 'Altyazılar için Google Cloud kullan',
  enabled: 'açık',
  granted: 'verildi',
  none: 'yok',
  'not granted': 'verilmedi',
  off: 'kapalı',
  'remembered on this device': 'bu cihazda hatırlanıyor',
  selected: 'seçili',
  'this session only': 'yalnızca bu oturum',
  'for captions': 'altyazılar için',
  'when you activate captions. No audio, video, website cookies or credentials are sent.':
    'Altyazıyı etkinleştirdiğinde gönderilir. Ses, video, site çerezleri veya anahtarlar gönderilmez.',
  'Delete saved keys, preferences, translations and playback sessions? Provider request budgets and uncertain-request guards remain until this browser session ends.':
    'Kayıtlı anahtarlar, tercihler, çeviriler ve oynatma oturumları silinsin mi? İstek bütçeleri ve belirsiz istek korumaları tarayıcı oturumu bitene kadar kalır.',
});

Object.assign(turkish, {
  'Provider rate limit reached. Waiting before further requests; original captions remain.':
    'Sağlayıcının hız sınırına ulaşıldı. Yeni istekler bekliyor; orijinal altyazılar korunuyor.',
  'Provider is cooling down after a failure. New cues can resume when the delay expires.':
    'Sağlayıcı hatasından sonra bekleniyor. Süre dolunca yeni altyazılarla devam edilebilir.',
  'A request may have been accepted before interruption. This batch will not be resent automatically; original captions remain.':
    'İstek kesintiden önce kabul edilmiş olabilir. Bu grup otomatik gönderilmeyecek; orijinaller korunuyor.',
  'Provider rejected the key or account access. Check the key, enabled API, restrictions and billing in settings; save the key to resume. Showing original captions.':
    'Anahtar veya hesap erişimi reddedildi. Anahtarı, API erişimini, kısıtları ve faturalandırmayı kontrol edip anahtarı yeniden kaydet. Orijinaller gösteriliyor.',
  'Provider quota or balance is unavailable. Check your provider account; save the key only after resolving it. Showing original captions.':
    'Sağlayıcı kotası veya bakiyesi yetersiz. Hesabını kontrol et; sorun çözüldükten sonra anahtarı yeniden kaydet. Orijinaller gösteriliyor.',
  'Provider rejected this configuration or language. Check the saved profile and language in settings. Showing original captions.':
    'Sağlayıcı bu ayarı veya dili kabul etmedi. Profili ve dili kontrol et. Orijinaller gösteriliyor.',
  'Provider key is missing or invalid. Enter it in settings. Showing original captions.':
    'Sağlayıcı anahtarı eksik veya geçersiz. Ayarlardan gir. Orijinaller gösteriliyor.',
  'Unsupported AI profile. Check settings. Showing original captions.':
    'AI profili desteklenmiyor. Ayarları kontrol et. Orijinaller gösteriliyor.',
  'Provider access was stopped by an earlier key or quota failure. Requests stopped for this browser session. Check your account, then explicitly save the key to resume.':
    'Önceki anahtar veya kota hatası nedeniyle istekler durduruldu. Hesabını kontrol edip devam etmek için anahtarı yeniden kaydet.',
  'Selected provider translation is off. Showing original captions.':
    'Seçili sağlayıcı kapalı. Orijinal altyazılar gösteriliyor.',
  'Provider access was removed. Restore it in settings and enable captions again. Showing original captions.':
    'Sağlayıcı erişimi kaldırıldı. Ayarlardan erişimi verip altyazıyı yeniden etkinleştir. Orijinaller gösteriliyor.',
  'Unsupported provider language code. Choose a supported source/target in settings and re-enable captions. Showing original captions.':
    'Dil kodu desteklenmiyor. Kaynak ve hedef dili kontrol edip altyazıyı yeniden etkinleştir. Orijinaller gösteriliyor.',
  'Local provider request limit reached. Showing original captions.':
    'Eklentinin istek sınırına ulaşıldı. Orijinal altyazılar gösteriliyor.',
  'The provider is busy with another caption. Showing original captions.':
    'Sağlayıcı başka bir altyazıyla meşgul. Orijinaller gösteriliyor.',
  'Google denied or throttled access. Translation stopped for this browser session.':
    'Google erişimi reddetti veya sınırladı. Bu tarayıcı oturumunda çeviri durduruldu.',
  'The provider timed out. Check connectivity and re-enable captions. Showing original captions.':
    'Sağlayıcı zamanında yanıt vermedi. Bağlantıyı kontrol edip altyazıyı yeniden etkinleştir. Orijinaller gösteriliyor.',
  'The provider could not be reached. Check connectivity and re-enable captions. Showing original captions.':
    'Sağlayıcıya ulaşılamadı. Bağlantıyı kontrol edip altyazıyı yeniden etkinleştir. Orijinaller gösteriliyor.',
  'The provider returned an unsupported response. Re-enable captions to retry, or choose another engine in settings. Showing original captions.':
    'Sağlayıcının yanıtı kullanılamıyor. Altyazıyı yeniden etkinleştir veya ayarlardan başka motor seç. Orijinaller gösteriliyor.',
  'Translation cancelled. Showing original captions.':
    'Çeviri iptal edildi. Orijinal altyazılar gösteriliyor.',
  'Translation stopped. Open the extension popup and choose Enable captions again.':
    'Çeviri durduruldu. Eklentiyi açıp altyazıyı yeniden etkinleştir.',
  'Original captions': 'Orijinal altyazılar',
  'Native timed track': 'Zamanlı video altyazısı',
  'Visible captions': 'Görünür altyazılar',
  'no cue timestamps': 'zaman bilgisi yok',
  manual: 'manuel',
  'auto-generated': 'otomatik oluşturulan',
  'No accessible caption text': 'Erişilebilir altyazı yok',
  'Caption source unavailable. Select a source track in YouTube, then re-enable.':
    'Kaynak altyazı alınamıyor. YouTube’da orijinal altyazıyı seçip yeniden etkinleştir.',
  'YouTube Auto-translate is selected. Choose an original track.':
    'YouTube otomatik çevirisi seçili. Orijinal altyazıyı seç.',
  'Turn on YouTube CC to read visible captions.':
    'Altyazıları okumak için YouTube CC’yi aç.',
  'Captions paused during the ad.': 'Reklam sırasında altyazılar duraklatıldı.',
  'Paid API': 'Ücretli API',
  Experimental: 'Deneysel',
  'Early development': 'Geliştirme aşamasında',
});

Object.assign(turkish, {
  'Caption support is experimental. Choose Google or your own AI provider in settings.':
    'Altyazı desteği deneyseldir. Ayarlardan Google veya kendi AI sağlayıcını seç.',
});

Object.assign(turkish, {
  'Waiting for next caption': 'Sonraki altyazı bekleniyor',
});

Object.assign(turkish, { 'User API': 'Kendi API hesabın' });
