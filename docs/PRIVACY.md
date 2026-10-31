# Privacy notice — limited preview

Last updated: 2026-10-31. Applies to AI Live Subtitle Translator 0.1.1-preview.1.
This describes the implemented extension. This file has not been published as a
hosted privacy-policy page and does not imply store approval.

Contact for privacy questions and private security reports:
**mitradenizkaratas@gmail.com**. Do not email API keys or personal transcripts.

## What the extension reads

After you enable captions, the extension reads available text tracks on the selected
main-document HTML5 video, or visible caption text on supported desktop YouTube
watch pages. It uses playback time, caption revisions, source language/track metadata,
and browser-provided tab/frame/document identity to keep results associated with the
correct video. It does not record video/audio, transcribe speech, read microphone
input, collect website cookies, or extract account credentials.

Manual activation uses temporary access to the selected page. Optional automatic
activation grants access only to `https://www.youtube.com/*`; it checks watch-page
navigation and player changes. A page-world reader on YouTube reads bounded video
and track metadata, not cookies, signed caption URLs or credentials. This metadata
is treated as untrusted. No browsing-history database is collected.

## Where text goes

No translation engine is selected by default. Enabling one requires an explicit
choice and its host permission. Requests go directly from your browser to that
provider over HTTPS. There is no project proxy, account server or analytics service.

| Choice                            | Recipient                                   | Information sent                                                                                                                     |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Experimental keyless Google       | Google, `translate.googleapis.com`          | Caption text in a URL query, source/target language and fixed client parameters; no API key                                          |
| Google Cloud Translation Basic v2 | Google Cloud, `translation.googleapis.com`  | Caption batches and source/target language in the request body; your key in a request header                                         |
| OpenAI                            | OpenAI, `api.openai.com`                    | Model, language pair, bounded caption batches with IDs/revisions and a translation instruction; your key in the Authorization header |
| DeepSeek                          | DeepSeek, `api.deepseek.com`                | The same bounded AI request fields and your origin-bound key                                                                         |
| Gemini OpenAI-compatible profile  | Google, `generativelanguage.googleapis.com` | The same bounded AI request fields and your origin-bound key                                                                         |

Other captions within the same AI batch provide context; no separate conversation,
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
| Translation results                                                  | Session cache: up to 128 batches / 256 KiB, usable for 30 minutes. Optional device cache: same bounds, usable for 24 hours                                       |
| Cache identity                                                       | SHA-256 of provider/endpoint/model/languages/config and ordered caption text/context; raw source text is not separately stored in the cache                      |
| Active playback/job state                                            | Bounded session state containing tab/frame/document/origin bindings, IDs, hashes and expiry; playback/uncertain-job guards expire after 30 minutes               |
| Provider request counters/cooldown guards                            | Bounded session records; retained when clearing user data to prevent repeated paid dispatch, cleared with the browser/extension session                          |

Expiry is checked and stale entries are pruned on access, not by a permanent timer.
Expired device-cache bytes can remain stored until the next access, explicit clear
or extension removal. Cache output can itself reveal sensitive source content;
hashes do not make it anonymous. Pending caption text also exists in memory while
being processed; active work is cancelled on disable/invalidation.

Local/session storage access is restricted to trusted extension contexts before
sensitive operations. Device storage is not an encrypted vault. Keys are bound to
the selected endpoint origin, never synced by the extension, and not exposed to
content scripts. The extension does not support incognito operation.

## Your controls

- Disable captions to stop that playback session and restore native caption state.
  Disable automatic YouTube activation separately if you do not want it after refresh.
- Use **Original only** to pause translation. Resume via popup/settings, not page
  controls. Switching providers or languages invalidates pending results.
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
