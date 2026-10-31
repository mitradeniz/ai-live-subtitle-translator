# Draft store copy — limited preview

Prepared text only; no store listing or hosted release exists. This copy intentionally
excludes compatibility and live-provider claims that have not been verified.

## English

Name: AI Live Subtitle Translator

Short description: Translate available video captions with an experimental Google mode or your own API key. Limited preview.

Detailed description:

Read available captions in your preferred language while watching supported desktop
videos. Choose original, translated or bilingual text, adjust size, contrast and
position, and use English or Turkish controls.

This limited preview works with accessible HTML5 video text tracks and provides an
experimental visible-caption fallback on desktop YouTube watch pages. Enable
YouTube's original CC track; the fallback has no future caption timing and may lag.
Videos without accessible captions are not transcribed. Picture-in-Picture and
video-element fullscreen cannot display the custom overlay.

Choose experimental keyless Google or enter your own key for Google Cloud or a
supported OpenAI, DeepSeek or Gemini profile. Paid providers require your own account
and quota. Only specific endpoints/models are supported; live account verification
is still pending for this preview. Keyless Google relies on undocumented behavior
and can stop working. No paid provider is selected automatically.

Caption text is sent directly to the provider you choose. There is no project
backend or analytics service. Keys use session storage unless you explicitly choose
device retention. Clear keys/cache in settings and revoke site/provider access at
any time. Device storage is not an encrypted vault. Read the privacy notice before use.

## Türkçe

Ad: AI Live Subtitle Translator

Kısa açıklama: Mevcut video altyazılarını deneysel Google modu veya kendi API anahtarınla çevir. Sınırlı önizleme.

Açıklama:

Desteklenen masaüstü videolarında erişilebilir altyazıları seçtiğin dilde oku.
Orijinal, çeviri veya iki dilli görünüm; yazı boyutu, kontrast ve konum ayarları;
Türkçe ve İngilizce arayüz sunar.

Bu sınırlı önizleme, erişilebilir HTML5 altyazılarını ve masaüstü YouTube'daki görünür
altyazıları kullanır. YouTube'da orijinal CC açık olmalıdır; görünür altyazı yöntemi
gelecekteki metne erişemez ve gecikebilir. Altyazısı olmayan videolar için konuşma
tanıma yapmaz. Resim içinde resim ve doğrudan video öğesinin tam ekranında özel
altyazı katmanı desteklenmez.

Deneysel anahtarsız Google veya kendi Google Cloud, OpenAI, DeepSeek ya da Gemini
anahtarını seçebilirsin. Ücretli sağlayıcılar kişisel hesap ve kota gerektirir; yalnızca
belirli adres/model eşleşmeleri desteklenir. Bu önizlemenin canlı hesap doğrulaması
henüz tamamlanmamıştır. Anahtarsız Google belgelenmemiş davranışa dayanır ve kesilebilir.
Ücretli bir hizmet otomatik seçilmez.

Altyazılar doğrudan seçtiğin sağlayıcıya gönderilir. Proje sunucusu veya analitik yoktur.
Anahtarlar varsayılan olarak oturumda tutulur; cihazda saklama isteğe bağlıdır.
Ayarlardan anahtarları/önbelleği temizleyebilir, site/sağlayıcı erişimini kaldırabilirsin.
Cihaz depolaması şifreli bir kasa değildir. Kullanmadan önce gizlilik bildirimini oku.

## Captured assets

`pnpm test:release` captures actual settings from a clean install of the verified
normal ZIP at ordinary Chrome 90% page zoom, with no stored key or provider request. It writes 1280×800 PNG screenshots:

- `.output/store-assets/0.1.1-preview.1/01-settings-en.png`: English viewing controls.
- `.output/store-assets/0.1.1-preview.1/02-settings-tr.png`: Turkish viewing controls.

No mock caption output, real video transcript, account data or invented UI is shown.
`capture.json` records browser/version/archive hash. These generated assets stay out
of source commits and the extension ZIP. The committed icon is `public/icons/icon-128.png`.
Before submission, inspect screenshots and store icon sizing against the current
[Chrome image requirements](https://developer.chrome.com/docs/webstore/images).
Contact: mitradenizkaratas@gmail.com. No website/privacy URL or publisher ID has been invented.
