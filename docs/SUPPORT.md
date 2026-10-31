# Support matrix — 0.2.2-preview.1

This is a production-optimized **limited preview**, not a fully verified beta.
The implementation has local automated checks; provider/account and owner-browser
results must be reported separately. No universal video or model compatibility is claimed.

| Surface                             | Implemented behavior                                                        | Verification / limits                                                                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium 151.0.7922.34, macOS arm64 | MV3 popup/options, messaging, storage and caption pipeline                  | Automated isolated profiles, production and mock artifacts; preview archive installation checked separately                                                                                                                                    |
| Desktop Chrome 151+                 | Declared minimum; main release target                                       | Owner passed earlier controls/security retest. Clean install of this preview awaits owner; exact owner version must be recorded                                                                                                                |
| Microsoft Edge, Opera, Brave        | Same Chromium MV3 package; needs a Chromium 151+ engine                     | Not tested; no supported version claimed. See README "Other browsers"                                                                                                                                                                          |
| Firefox desktop 153+                | MV3 background scripts, extension-origin durable store                      | Separate Firefox artifact; browser-provided document binding and trusted-only session storage. Firefox 159 automated checks; minimum 153 is API-based, not separately browser-tested                                                           |
| Safari, mobile, incognito           | No supported build                                                          | Not supported                                                                                                                                                                                                                                  |
| Native HTML5 video text tracks      | Clock-based cues, overlaps, pause/seek/rate, revisions and track changes    | Synthetic redistributable fixtures; main document's largest visible video only; inaccessible tracks/iframes excluded                                                                                                                           |
| Desktop YouTube watch pages         | Player-response capture, sentence preparation and visible fallback          | Owner passed prior YouTube checks; synthetic SPA/player/revision tests. CC must be on. Early capture requires explicit automatic YouTube access and refresh. Live signed-out probe still empty; packaged capture tests use synthetic responses |
| Fullscreen                          | Ancestor container containing the video and overlay                         | Synthetic container fullscreen tested; video-element fullscreen and Picture-in-Picture cannot display the custom overlay                                                                                                                       |
| No captions / unavailable source    | No invented transcript or speech recognition; source state or empty overlay | Native/YouTube fixtures; owner must also check a real no-caption video                                                                                                                                                                         |
| English/Turkish UI                  | Keyboard controls, focus states, RTL caption direction                      | Automated UI checks; translation language coverage depends on the provider                                                                                                                                                                     |

## Page tools (experimental)

Main-document HTTP(S) ordinary text is translated on visibility, including bounded
new content after scrolling. Selection, Alt-hover, plain textarea/text/search-input
translation and AI Writing previews are implemented. They share configured provider
profiles with captions; writing requires an AI profile. All previews are plain text;
field application requires an explicit click and an unchanged target value. No form
submission is automated. Rich editors/contenteditable, iframe/shadow-root text,
PDFs and browser-internal pages are unsupported. Provider changes happen in the
trusted popup opened by the page menu. Automatic logo access is an explicit all-sites or per-host opt-in;
manual activation continues to use temporary activeTab access.

Synthetic packaged tests cover data exclusions, visible-only dispatch, scrolling,
restoration, stale results/field edits and mocked writing. This is not live-site or
live-provider qualification. See README for exact limits and activation instructions.

## Translation profiles

| Engine                      | Implemented profile                                                                            | Evidence for this preview                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Experimental keyless Google | Fixed undocumented Google endpoint; no key                                                     | Previous owner English→Turkish success; offline contract/browser regressions. No guarantee of availability or distribution rights |
| Google Cloud                | Translation Basic v2 with your API key                                                         | Mocked contracts, alignment, errors, revocation and switching; live key/account verification required for this artifact           |
| OpenAI                      | Chat Completions; `gpt-5.4-mini-2026-03-17` or `gpt-5.4-mini`                                  | Mocked contracts and lifecycle tests; prior live OpenAI check was deferred                                                        |
| DeepSeek                    | `https://api.deepseek.com/chat/completions`, `deepseek-flash`                                  | Owner reports a successful small paid test; mocked playback passes, live playback retest pending for this popup                   |
| Gemini                      | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, `gemini-3.8-flash` | Mocked compatibility profile; live key/account verification required for this artifact                                            |

Only the listed endpoint/model combinations are accepted. Models/account access can
change. BYOK providers may require billing/quota; a failed key or quota response is
not evidence of successful translation. Each account test is an explicit user action.
Original text is retained on invalid/failed output; no paid engine is selected as a fallback.

## Known limitations

Observed YouTube captions cannot reveal future words. Only complete punctuated
visible text is translated on that fallback; unpunctuated speech may not translate.
For advance output, enable automatic YouTube access and refresh before playback. In translation-only
mode the extension waits for the current result; it does not first flash the source.
Failure restores original text. YouTube's native CC is temporarily transparent while
the extension renders the replacement; disabling restores its previous styling. There is no zero-latency or translation-quality guarantee.

Native/YouTube timed-track prefetch is bounded to 20 seconds / 12 cues, including while paused; observed text has no future-caption access. Sessions
expire after 30 minutes. Navigation/source replacement stops manual playback; explicitly
opted-in YouTube activation can start a new document-bound session. Browser throttling
and provider limits affect fast playback. Uncertain paid requests are not automatically
retried; exactly-once billing cannot be guaranteed after worker interruption.

The project has no public backend, proxy or telemetry. Read [privacy](PRIVACY.md),
[release notes](RELEASE_NOTES.md) and the [README](../README.md) before installing.

Automatic edge controls offer a one-time all-sites HTTP(S) grant or narrower per-host
opt-in. The chosen scope survives restart until disabled or access is revoked.
Hover-menu Page/Video choices are saved. The idle logo reconnects after session
expiry without restarting translation. Browser-internal/private pages are excluded;
nonstandard-port pages remain manual-only.

## Course players and responsiveness

The popup loads provider/settings data without waiting for the page. Native track
mode changes are observed by a bounded poll, and page-text discovery yields between
small batches. An isolated synthetic lesson covers a large changing transcript, a
player that reasserts native captions, and unresponsive status reads. This does not
verify DeepLearning.AI's signed-in player or any other course site's account state.

With page tools enabled, a glass button inside the largest visible main-document
video opens a compact caption switch/download/settings menu without starting a
translation request. The switch uses the document-bound playback state. Download
support is limited to already-loaded, unambiguous native source tracks, saved as
VTT; observed captions without timing and translated-track export are unsupported.
It occupies a slot beside
CC/settings in recognized HTML control rows (Video.js, JW, Shaka, Vidstack-style
rows and semantic toolbars). Selectors are compatibility hints, not a promise of
universal player support. Unknown layouts and browser-native controls use the
page-edge menu. The button follows native toolbar hiding and replacement. Main-document
HTML5 tracks and supported container fullscreen are required; iframe/shadow-root
players, video-element fullscreen and Picture-in-Picture remain unsupported.
