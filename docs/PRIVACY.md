# Privacy notice — limited preview

Last updated: 2026-11-02. Applies to AI Video Subtitle Translator 0.2.3-preview.1.0.2.3-preview.1.

This noticeThis notice describes the implemented extension and its optional translation
services. Publication of this notice does not imply store approval.

Contact for privacy questions and private security reports:
**mitradenizkaratas@gmail.com**. Do not email API keys or personal transcripts.

## What the extension reads

After you enable captions, the extension reads available text tracks on the selected
main-document HTML5 video, or available timed/visible caption text on supported desktop YouTube
watch pages. It uses playback time, caption revisions, source language/track metadata,
and browser-provided tab/frame/document identity to keep results associated with the
correct video. It does not record video/audio, transcribe speech, read microphone
input, collect website cookies, or extract account credentials.

Manual activation uses temporary access to the selected page. Optional automatic
caption activation grants access only to `https://www.youtube.com/*`; it checks watch-page
navigation and player changes. A page-world reader on YouTube reads bounded video
and track metadata. With explicit automatic YouTube consent, a packaged reader
starts when a watch page opens and can temporarily hold the selected original
track before the playback session is ready. It observes only current-video
YouTube caption XHR/fetch responses. It does not change the website's requests,
cookies or responses, replay signed URLs, extract authentication tokens, or make
privileged caption downloads. At most one player caption reload is requested per
source, eight per reader lifetime; response reads are also bounded.

Normalized captions are limited to one MiB / 200,000 text characters / 5,000 cues.
The page reader does not receive API keys. URLs and request headers are not sent
to providers or stored/exported. Disabling captions restores request functions
and native caption styling; one normalized track can remain in page memory for
up to 30 minutes to support re-enable. Navigation, page closure, site opt-out or
clearing all extension data removes it. No browsing-history database is collected.

After activation, timed-caption translation may prepare up to 20 seconds / 12
units ahead, including while paused. Units combine source pieces up to punctuation,
with bounded length/duration. Preparation can use quota for captions not yet watched;
disabling stops provider work. The draggable control's position/hidden state is
held only by the current overlay. Its settings button opens the fixed extension
options page and receives no credentials or configurable destination.

## Page and writing tools

Page tools require a deliberate popup action on the current HTTP(S) main document.
The optional automatic logo stores either an all-sites opt-in or exact sites you
allow (up to 64), plus sites where you hid the logo from its own settings (up to
256, origins only). Hiding until a page is reloaded is not stored. “Show the logo on all sites” explicitly requests HTTP(S) access
across websites once. Alternatively, the per-site option requests one host at a time.
Installation itself grants no hosts. Packaged main-frame scripts run on the chosen
scope; they show idle controls, and no text is transmitted by showing the logo or
choosing Page/Video. Access is rechecked on restart. Revoking broad access disables
the all-sites mode; turning that mode off also clears earlier per-site choices.
Turning off automatic display leaves Chrome host grants unchanged because other
features may use them. There is no automatic page translation. Visible
ordinary text is processed as you scroll; mutation and intersection observers track
new visible content within fixed scan/node/character bounds. Automatic translation
skips form controls, editable areas, hidden text, code, and translate-disabled regions.
It does not access iframe or shadow-root content. This does not identify every kind
of sensitive information displayed as ordinary page text; choose pages deliberately.

Selected text (up to 1,000 characters) is transmitted after an explicit translation
action — clicking the small marker shown under a selection, or Translate selection in the
edge menu — or after a mouse selection when you separately enable **Translate
automatically after selection**. Showing the marker sends nothing. Automatic translation after selection defaults off, including for existing installations.
Automatic selections go to the selected provider/target language and can incur its
charges. One selection request runs at a time; only the latest pending selection is
kept. Closing the preview discards pending/displayed results; an already dispatched
request may still finish and be billed. Optional
Alt-hover translation sends the hovered ordinary text after 650 ms. Text-field
translation and AI Writing send the requested field value or entered brief, up to
1,000 characters, only when explicitly triggered. Password fields and recognizable
payment/account fields are excluded. Writing adds a fixed improvement/shortening/
formal/drafting instruction. It uses your selected AI account and may incur charges.
Results are shown as plain previews; applying a preview does not submit a form.

Page/selection/field/writing results bypass both persistent and session translation
caches. Current text, originals for restoration, drafts and results live only in the
content context until it is disposed, the page navigates/reloads, or its 30-minute
session expires. A bounded in-memory page result can be reused on that page. Page
feature preferences persist locally until changed/cleared; settings export currently
covers caption/language preferences, not the page-tool feature selections. Minimal
trusted session IDs, document identity and hashed job journals use extension session
storage for cancellation and uncertain paid-request recovery. They contain no raw
page text or writing drafts. Provider-side retention is independent of these controls.

## Where text goes

No translation engine is selected by default. Enabling one requires an explicit
choice and its host permission. Requests go directly from your browser to that
provider over HTTPS. There is no project proxy, account server or analytics service.

| Choice                            | Recipient                                   | Information sent                                                                                                                          |
| --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Experimental keyless Google       | Google, `translate.googleapis.com`          | Requested text in a URL query, source/target language and fixed client parameters; no API key                                             |
| Google Cloud Translation Basic v2 | Google Cloud, `translation.googleapis.com`  | Text batches and source/target language in the request body; your key in a request header                                                 |
| OpenAI                            | OpenAI, `api.openai.com`                    | Model, language pair, bounded text batches with IDs/revisions and a translation/writing instruction; your key in the Authorization header |
| DeepSeek                          | DeepSeek, `api.deepseek.com`                | The same bounded AI request fields and your origin-bound key                                                                              |
| Gemini OpenAI-compatible profile  | Google, `generativelanguage.googleapis.com` | The same bounded AI request fields and your origin-bound key                                                                              |

Other text items within the same AI batch provide context; no separate conversation,
full transcript or unlimited history is sent. Providers receive ordinary network
metadata such as your IP address. The extension omits website cookies and referrers
and does not include the video URL in translation requests. Keyless query text may
appear in provider/network tooling logs even though HTTPS protects transport.

Providers apply their own account, processing and retention policies. The extension
cannot promise provider-side deletion or zero retention. Consult the selected
provider's current terms and privacy settings. Deleting local data does not recall
already transmitted text. No silent provider fallback occurs. Explicit small paid
tests send the synthetic phrase “Hello, world.”; saving a key does not test it.

## Storage and retention on your device

| Data                                                                 | Storage and lifetime                                                                                                                                             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language/display preferences, provider/model selection, opt-in flags | Local extension storage until changed, cleared or extension removal                                                                                              |
| API keys                                                             | Session storage by default; cleared on browser restart or extension reload/update. Explicit “remember” stores a key on device until deletion/replacement/removal |
| Caption translation results                                          | Session cache: up to 128 batches / 256 KiB, usable for 30 minutes. Optional device cache: same bounds, usable for 24 hours                                       |
| Cache identity                                                       | SHA-256 of provider/endpoint/model/languages/config and ordered caption text/context; raw source text is not separately stored in the cache                      |
| Active playback/job state                                            | Bounded session state containing tab/frame/document/origin bindings, IDs, hashes and expiry; playback/uncertain-job guards expire after 30 minutes               |
| Provider request counters/cooldown guards                            | Bounded session records; retained when clearing user data to prevent repeated paid dispatch, cleared with the browser/extension session                          |

The popup keeps at most 32 recent per-tab pending/result/error states, timestamps and request durations in worker
memory, without captions, keys, URLs or provider error bodies. They are shown for up
to five minutes, cleared on session invalidation and lost on worker restart. These
summaries are not exported or sent anywhere. Provider icons are packaged locally.

Expiry is checked and stale entries are pruned on access, not by a permanent timer.
Expired device-cache bytes can remain stored until the next access, explicit clear
or extension removal. Cache output can itself reveal sensitive source content;
hashes do not make it anonymous. Pending caption text also exists in memory while
being processed; active work is cancelled on disable/invalidation.

Chromium local/session storage is restricted to trusted extension contexts before
sensitive operations. Firefox keeps authoritative durable settings, remembered
keys and optional cached results in IndexedDB at the extension's own origin,
which content scripts cannot access. Temporary keys and jobs use Firefox's
trusted-only session storage. Firefox's ordinary local extension storage contains
only a random change-notification token; it is not a source of trusted preferences
or keys. Firefox asks for data-transmission consent during installation; requested
page/caption/writing text can contain personal information or communications. Device storage is not an encrypted vault. Keys are bound to
the selected endpoint origin, never synced by the extension, and not exposed to
content scripts. The extension does not support incognito operation.

## Your controls

The player menu's **Download subtitles** action saves already-loaded native source
cues to a local VTT file, only when clicked. It makes no provider request, loads no
remote caption URL, and includes no key or browsing-history metadata. It does not
export translated text. A file you explicitly download remains in your downloads
folder after clearing extension data; delete it there if no longer needed.

- Disable captions to stop that playback session and restore native caption state.
  Disable automatic YouTube activation separately if you do not want it after refresh.
- Use **Original only** to pause translation. Resume through the popup/settings or the player menu after explicitly choosing
  a configured provider. Switching providers or languages invalidates pending results.
- Delete keys in **Open settings → API keys and privacy**. Remove provider/site access
  using the corresponding controls or Chrome's extension settings.
- **Clear translation cache** clears session and device translations and stops active
  work. **Delete saved data and keys** also removes credentials, preferences, AI
  profile and playback sessions, turns translation/automatic activation off and
  disables persistent caching. Browser host grants and session cost-safety records
  remain; revoke access separately. Provider-side data is unaffected.
- Settings export includes saved preferences without credentials, cached captions,
  provider responses or browser history. The project adds no caption/key logging or
  telemetry. If you send a report by email, that message is handled by the designated
  contact's email provider; keep reports synthetic and redact personal information.

The developer does not receive caption text or keys through a project service and
does not sell extension data or use it for advertising. Text transmission to your
selected translation provider is the extension's disclosed purpose.

The extension's use of information received from Google APIs adheres to the
Chrome Web Store User Data Policy, including the Limited Use requirements.
