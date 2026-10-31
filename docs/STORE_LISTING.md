# Store copy — limited preview

Listing content for version 0.2.1-preview.1. This document is not evidence of
store approval. Compatibility and live-provider claims are limited to actual checks.

## English

Name: AI Video Subtitle Translator

Short description: Translate visible page text and available captions with Google or your own API key. Limited preview.

Detailed description:

Free to install and open source. The experimental keyless Google option does not
require an API key. Optional AI and Google Cloud services use your own account and
may charge for usage; installing this extension does not include paid API credits.

Read available captions in your preferred language while watching supported desktop
videos. Choose original, translated or bilingual text, adjust size, contrast and
position, and use English or Turkish controls.

This limited preview works with accessible HTML5 video text tracks and provides an
experimental timed-response capture on desktop YouTube watch pages. Enable
original CC and explicitly allow automatic YouTube access, then refresh once.
Unavailable timed data falls back to visible text, which cannot provide lookahead.
Videos without accessible captions are not transcribed. Picture-in-Picture and
video-element fullscreen cannot display the custom overlay.

Choose experimental keyless Google or enter your own key for Google Cloud or a
supported OpenAI, DeepSeek or Gemini profile. Paid providers require your own account
and quota. Only specific endpoints/models are supported; live account verification
is still pending for this preview. Keyless Google relies on undocumented behavior
and can stop working. No paid provider is selected automatically.

Opt into visible-page translation, selected-text and Alt-hover previews, plain
text-field translation, or AI Writing previews. A page-edge glass menu offers quick
actions; configured providers and target languages can also be changed in the
player menu. Page translation processes new
visible text as you scroll and can restore originals. Writing requires a configured
AI profile. Field edits need explicit application; no form submission is automated.
Rich editors, iframes and PDFs are unsupported. Requested page/writing text stays out
of the persistent caption cache; see the privacy notice for exact retention.

Requested text is sent directly to the provider you choose. There is no project
backend or analytics service. Keys use session storage unless you explicitly choose
device retention. Clear keys/cache in settings and revoke site/provider access at
any time. Device storage is not an encrypted vault. Read the privacy notice before use.

## Türkçe

Ad: AI Video Subtitle Translator

Kısa açıklama: Görünen sayfa metnini ve altyazıları Google veya kendi API anahtarınla çevir. Sınırlı önizleme.

Açıklama:

Ücretsiz kurulabilir ve açık kaynaklıdır. Deneysel anahtarsız Google seçeneği API
anahtarı istemez. İsteğe bağlı AI ve Google Cloud hizmetleri kendi hesabını kullanır
ve kullanım ücreti alabilir; eklenti ücretli API kredisi sağlamaz.

Desteklenen masaüstü videolarında erişilebilir altyazıları seçtiğin dilde oku.
Orijinal, çeviri veya iki dilli görünüm; yazı boyutu, kontrast ve konum ayarları;
Türkçe ve İngilizce arayüz sunar. Sürüklenebilir kare kontrolden hızlı ayarlara
ulaşabilir, kontrolü gizleyip tekrar açabilirsin.

Bu sınırlı önizleme, erişilebilir HTML5 altyazılarını ve YouTube oynatıcısının
yüklediği zamanlı altyazıları kullanır. Orijinal CC'yi ve otomatik YouTube erişimini
açıp sayfayı bir kez yenile. Zamanlı veri alınamazsa görünür metin yöntemi
gelecekteki kelimelere erişemez ve gecikebilir. Altyazısı olmayan videolar için konuşma
tanıma yapmaz. Resim içinde resim ve doğrudan video öğesinin tam ekranında özel
altyazı katmanı desteklenmez.

Deneysel anahtarsız Google veya kendi Google Cloud, OpenAI, DeepSeek ya da Gemini
anahtarını seçebilirsin. Ücretli sağlayıcılar kişisel hesap ve kota gerektirir; yalnızca
belirli adres/model eşleşmeleri desteklenir. Bu önizlemenin canlı hesap doğrulaması
henüz tamamlanmamıştır. Anahtarsız Google belgelenmemiş davranışa dayanır ve kesilebilir.
Ücretli bir hizmet otomatik seçilmez.

Görünen sayfa çevirisini, seçili metin/Alt ile üzerine gelme önizlemelerini,
normal yazı alanı çevirisini ve AI Yazım araçlarını ayrı ayrı açabilirsin. Kenardaki
cam menü hızlı işlemler sunar; yapılandırılmış sağlayıcı ve hedef dil oynatıcı
menüsünden de değiştirilebilir.
Kaydırdıkça yeni görünen metinler çevrilir ve orijinal görünüm geri getirilebilir.
AI Yazım için yapılandırılmış AI sağlayıcısı gerekir. Yazı alanına uygulama açık bir
tıklama gerektirir; form gönderilmez. Zengin editörler, iframe ve PDF desteklenmez.
Sayfa/yazım sonuçları kalıcı altyazı önbelleğine alınmaz.

İstenen metin doğrudan seçtiğin sağlayıcıya gönderilir. Proje sunucusu veya analitik yoktur.
Anahtarlar varsayılan olarak oturumda tutulur; cihazda saklama isteğe bağlıdır.
Ayarlardan anahtarları/önbelleği temizleyebilir, site/sağlayıcı erişimini kaldırabilirsin.
Cihaz depolaması şifreli bir kasa değildir. Kullanmadan önce gizlilik bildirimini oku.

## Captured assets

`pnpm test:release` captures actual settings from a clean install of the verified
normal ZIP at ordinary Chrome 90% page zoom, with no stored key or provider request. It writes 1280×800 PNG screenshots:

- `.output/store-assets/0.2.1-preview.1/01-settings-en.png`: English viewing controls.
- `.output/store-assets/0.2.1-preview.1/02-settings-tr.png`: Turkish viewing controls.

No mock provider output, real video transcript, account data or invented UI is shown.
The settings caption preview contains fixed illustrative text; it is not a live
translation result.
`capture.json` records browser/version/archive hash. These generated assets stay out
of source commits and the extension ZIP. The committed icon is `public/icons/icon-128.png`.
Before submission, inspect screenshots and store icon sizing against the current
[Chrome image requirements](https://developer.chrome.com/docs/webstore/images).
Contact: mitradenizkaratas@gmail.com. No website/privacy URL or publisher ID has been invented.

An optional logo can appear across websites after a one-time all-sites HTTP(S)
permission grant, or only on individually allowed sites. Hover to select Page or
Video; click to start. Showing the logo or choosing an action does not send text.
Turn off the all-sites switch to stop automatic display.
