# Support matrix — 0.1.2-preview.1

This is a production-optimized **limited preview**, not a fully verified beta.
The implementation has local automated checks; provider/account and owner-browser
results must be reported separately. No universal video or model compatibility is claimed.

| Surface                             | Implemented behavior                                                        | Verification / limits                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium 151.0.7922.34, macOS arm64 | MV3 popup/options, messaging, storage and caption pipeline                  | Automated isolated profiles, production and mock artifacts; preview archive installation checked separately                                                 |
| Desktop Chrome 151+                 | Declared minimum; main release target                                       | Owner passed earlier controls/security retest. Clean install of this preview awaits owner; exact owner version must be recorded                             |
| Microsoft Edge                      | Chromium-based target                                                       | Not tested; no supported Edge version claimed                                                                                                               |
| Firefox, Safari, mobile, incognito  | No supported build                                                          | Not supported                                                                                                                                               |
| Native HTML5 video text tracks      | Clock-based cues, overlaps, pause/seek/rate, revisions and track changes    | Synthetic redistributable fixtures; main document's largest visible video only; inaccessible tracks/iframes excluded                                        |
| Desktop YouTube watch pages         | Visible-caption fallback with track/source metadata                         | Owner passed prior YouTube checks; synthetic SPA/player/revision tests. CC must be on. No reliable future timestamps/lookahead; caption delivery can change |
| Fullscreen                          | Ancestor container containing the video and overlay                         | Synthetic container fullscreen tested; video-element fullscreen and Picture-in-Picture cannot display the custom overlay                                    |
| No captions / unavailable source    | No invented transcript or speech recognition; source state or empty overlay | Native/YouTube fixtures; owner must also check a real no-caption video                                                                                      |
| English/Turkish UI                  | Keyboard controls, focus states, RTL caption direction                      | Automated UI checks; translation language coverage depends on the provider                                                                                  |

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

Observed YouTube captions can change while being spoken. Stabilization and network
latency delay output; incomplete phrases can produce poor translations. In translation-only
mode the extension waits for the current result; it does not first flash the source.
Failure restores original text. YouTube's own CC layer remains visible because it is
the source of observed text. There is no zero-latency or translation-quality guarantee.

Native-track prefetch is bounded; observed text has no future-caption access. Sessions
expire after 30 minutes. Navigation/source replacement stops manual playback; explicitly
opted-in YouTube activation can start a new document-bound session. Browser throttling
and provider limits affect fast playback. Uncertain paid requests are not automatically
retried; exactly-once billing cannot be guaranteed after worker interruption.

The project has no public backend, proxy or telemetry. Read [privacy](PRIVACY.md),
[release notes](RELEASE_NOTES.md) and the [README](../README.md) before installing.
