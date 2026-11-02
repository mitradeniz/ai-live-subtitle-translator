# 0.2.2-preview.1

Adds a separate Firefox MV3 build with document-bound messaging, private durable storage and Firefox installation-time data disclosures. Chromium artifacts use the existing trusted storage boundary. Browser and live-provider verification limits are documented in SUPPORT.md.

- Offer 30 widely used languages (including Arabic, Hebrew, Persian, Hindi,
  Japanese, Korean and Simplified/Traditional Chinese) in the popup, settings,
  player menu and selection preview. The Google providers accept the same list.
- Selected text: a small round marker in the extension's colors appears just
  under the end of a mouse selection, and the translation opens only when it is
  clicked. Selected text translation is now on by default because the marker
  sends nothing by itself; automatic translation after selection stays off. The
  preview's language choices apply to these clicks too.
- Pages start in translation-only display. The YouTube caption track is treated
  as an original track by default, so it no longer has to be confirmed each time.
  Page preferences saved by earlier versions move to these defaults (and to the
  selection marker) once; each can be changed in Customize translation.
- The page-edge button and its menu step aside while the page is in fullscreen.
- The page-edge button is smaller and works as an on/off switch for page
  translation, with a subtler check in its corner. Hovering shows what a click
  will do, the latest status, a **More options** button for the menu and × to
  hide it.
- Changing languages no longer asks for a restart: languages picked in the popup
  (or swapped) save at once, and running subtitles continue in the new language.
  The player menu does the same after a language or provider change.
- The player menu loads provider and language even when the subtitle status check
  is slow or fails, and is removed when its page-tools session expires.

Page preferences move to a new storage key (`page-preferences.v3`); older keys
are removed after the first save and by Clear data. No permissions or network
destinations changed.

# 0.2.1-preview.1 — 2026-10-31

- Use **AI Video Subtitle Translator** as the extension display name.
- Redesign the popup, settings and in-page controls in a liquid glass style:
  translucent panels over a static aurora background, rim highlights and
  spring-eased switches and segmented controls. The system font stack is used;
  no remote fonts or images are loaded.
- Split the popup into **Video subtitles** and **Page translation** tabs so the
  default view fits without scrolling; the last tab is remembered locally. Add a
  language swap button and mark unsaved popup preferences.
- Add a live caption preview to settings that follows font size, background,
  position, display mode and target language.
- Render checkboxes as switches with native checkbox semantics; this also fixes
  the oversized checkbox in the popup's page tools.
- Show Glass captions in a frosted capsule; **Solid background** stays plain black.
  Blur is removed when the system asks for reduced transparency.
- Redraw the extension icon as a glass lens over an aurora tile, with a simplified
  16/32 px variant.
- Add **Swap languages** to the player menu. It exchanges the saved source and
  target languages, shows the current pair and is disabled for auto-detect. Like
  a target-language change there, it stops translation until it is turned on again.
- Simplify the page-edge menu: clicking the logo opens or closes it (hover no longer
  opens it), and it lists only the enabled tools with one translate/restore button and
  a video subtitles switch. The edge-button action choice is removed from the menu and
  popup. A badge on the logo shows a check mark while page or video translation runs.
- Document distribution in Edge, Opera and Brave (same Chromium package, not yet
  tested) and why there is no Firefox build yet.

No permissions, network destinations or stored data types changed.

# 0.2.0-preview.1 — 2026-10-31

- Keep popup provider controls usable when the page does not answer status reads;
  bound status waits and prevent overlapping popup polls.
- Avoid repeated native track-mode writes and event-driven player feedback loops.
  Discover page text in small batches on large, changing documents.
- Add a glass shortcut beside CC/settings in recognized player control bars while
  page tools are enabled; hide it with the bar and reconnect after replacement.
  Its compact menu offers a playback-state switch, local native-source VTT download
  and settings. Opening it does not translate; starting captions remains an explicit
  action and does not change the edge-button preference.

- Add opt-in visible-page translation, loading new text as it scrolls into view.
  Restore original text without replacing existing link elements or submitting forms.
- Add a large popup action, feature customization, separate page display mode and
  page-edge tools with click actions, hover menu, keyboard movement and hide/show.
- Add selected-text and deliberate Alt-hover previews; text-field translation and
  AI Writing (improve, shorten, formal, draft) preview before optional application.
- Reuse existing provider profiles, origin-bound credentials, bounded queues and
  fixed network destinations. Page jobs have separate document-bound sessions and
  bypass translation caches. Required permissions are unchanged.
- Add an opt-in automatic logo on individually granted HTTP(S) sites, with saved
  Page/Video choices in the hover menu. Optional wildcard host declarations support
  exact-site requests. A separate all-sites switch requests HTTP(S) access once and
  keeps the idle logo visible across supported sites until disabled. Neither mode
  starts page translation automatically.
- Keep provider/language changes in the trusted popup; changes stop page work and
  restore originals. Navigation/expiry ends page activation.

Limited preview. Main-document ordinary text and plain fields only; rich editors,
iframes, PDFs and private/incognito windows are unsupported. Live site/provider
quality and new owner checks remain pending. No server, domain or proxy added.

# 0.1.5-preview.1 — 2026-10-31

- Use the YouTube player's own selected-track caption response instead of replaying
  its base URL. Explicit automatic YouTube access installs the bounded reader at
  document start; refresh once to capture the initial response. Normal website
  requests/responses are unchanged. A supported player reload is requested once.
- Combine timed pieces up to sentence-ending punctuation, with duration/length
  limits, and prepare them before playback. Incomplete visible fragments no longer
  cause word-by-word translation requests. Missing timing is still a real limitation.
- Reuse completed captions when seeking within the bounded prepared window, avoiding
  repeated requests for the same displayed cue. Pending old generations are discarded;
  changing source or configuration clears the prepared results.
- Add a draggable square glass control with keyboard movement, hide/show, display,
  text size, contrast, placement and a fixed link to general settings.
- Place translated text above original text; replace YouTube's native caption layer
  at its position and restore its inline styling on disable.
- Remove response hooks when disabled. Retain one bounded normalized track in page
  memory for re-enable, expiring after 30 minutes; clear it on navigation/site opt-out.

This remains a limited preview. Synthetic capture and UI tests are distinct from
owner/live-provider verification; the signed-out live probe still received empty
YouTube responses. No new required permissions, project backend or domain.

# 0.1.4-preview.1 — 2026-10-31

Limited preview: live YouTube timed-caption delivery is still unverified. The current
isolated public-video probe returned empty responses; this is not a claim that
YouTube latency has been solved.

- Try the selected original YouTube timed track before the visible fallback. Join
  complete text segments and preserve supplied intervals; do not translate each
  word as it appears. Reject unsupported incremental/append-only timing formats.
- Prepare the bounded 20-second / 12-cue window while paused after activation.
  Disable captions to stop preparation; skipped prefetched text can consume quota.
- Keep an in-flight future batch when one of its cues becomes current, avoiding
  cancellation of the very result needed on screen.
- Explicitly label unavailable advance translation. The visible-caption fallback
  still cannot read future captions and can lag behind speech.
- Fetch timed text only from the validated current-video YouTube path, without
  cookies, redirects or privileged URL-fetch messages. No new permissions/backend.

Parser, request boundaries and timed rendering have synthetic regression coverage.
Owner playback and provider latency must be checked separately.

# 0.1.3-preview.1 — 2026-10-31

- Show active, off, restart-required and blocked translation states separately.
  Active controls read **✓ Enabled**; changes that stop translation offer restart.
- Make saved/missing API keys and session/device retention visible on provider
  cards. Activation with a missing paid key is rejected before player injection.
  Session storage remains the default; device retention still requires opt-in.
- Display bounded local pending state and completed request duration without
  keys, transcripts or raw provider errors. No automatic paid tests were added.
- Completed observed sentences settle for 120 ms instead of 300 ms; rolling fragments
  retain 300 ms. Cancelled rate-spacing waits release cached work immediately.
  Rate limits, paid budgets, stale-revision rejection and retry bounds are unchanged.
- Fix horizontal popup overflow when a vertical scrollbar is present.

Owner confirmed the missing DeepSeek key had been saved only for the browser
session, so it was cleared by Reload. Enter it again in options and opt into
remembering on device if desired. Live playback with this correction awaits retest;
observed captions still depend on provider latency and YouTube's displayed text.

# 0.1.2-preview.1 — 2026-10-31

Limited preview; owner playback retest pending. Numeric manifest version: 0.1.2.

- The glass popup now exposes provider selection, language pair and display mode.
  Packaged provider icons identify integrations without remote image loading.
- Saved-key ticks distinguish storage from selection or a successful connection test.
  One AI key and a separate Cloud key are supported; other AI cards open setup.
- Current page status explains original-only mode, missing keys/access, and recent
  redacted playback failures. No automatic paid test or provider fallback was added.
- DeepSeek HTTP 422 now reports rejected configuration instead of a connectivity
  failure. This does not establish the cause of the owner's reported playback issue.
- The owner reports a successful DeepSeek small paid test. Live playback with the new
  controls remains unverified; automated coverage uses synthetic captions/fake keys.

Reload the unpacked extension and refresh the video. Session-only keys are cleared
by extension reload; remembered device keys remain. Select the saved provider,
choose Translation only or Original and translation, then Enable captions.

# 0.1.1-preview.1 — 2026-10-31

First versioned, extension-only owner preview package. Numeric manifest version is
0.1.1; visible version is 0.1.1-preview.1. This production build is a limited preview,
not a store-approved release or a fully verified beta.

Included behavior:

- Native HTML5 timed captions and experimental YouTube visible-caption handling.
- Explicit keyless Google, Google Cloud and AI BYOK engine choices; exact reviewed
  OpenAI/DeepSeek/Gemini profiles, session-first keys and optional device retention.
- English/Turkish controls, original/translated/bilingual modes, font size, contrast,
  position, RTL text and optional automatic activation on the exact YouTube origin.
- Bounded queues/cache/retries, stale-result rejection and worker-interruption guards.
- Trusted UI authorization for resuming translation from original-only mode.
- Local scripts, narrow MV3 permissions/CSP, third-party notices and emitted-module
  provenance; versioned ZIP, SHA-256 checksum and exact file inventory.

The package contains no mock translator or fixture server. Source builds retain a
separate timing-test artifact, which must not be distributed as this preview.

Automated verification uses pinned Node 24.22.2, pnpm 11.28.10 and Chromium 151.0.7922.34
on macOS arm64. Frozen install, type/lint/format/unit checks, packaged provider/security
suites and clean archive installation are the verification commands documented in
[CONTRIBUTING](../CONTRIBUTING.md). They use synthetic data and fake keys; they do not
prove real account availability. See the [support matrix](SUPPORT.md).

Open release qualifications: clean owner installation and all advertised live
providers need verification; hosted CI has not run. One assessed moderate minimatch
advisory affects development tooling and is absent from bundled runtime modules.
No high/critical advisory was reported by the recorded scan. The private reporting
contact is established; a hosted privacy-policy URL, publisher account and provider/
store distribution review are still required before submission. No hosting, store
submission or remote release is part of this package.

For an isolated first install, use a separate Chrome profile and extract the ZIP to
a stable folder. Do not remove your existing profile/extension just to test this
preview. Different unpacked paths may produce different extension IDs and separate
storage; there is no automatic key migration between them. An extension reload/update
clears session keys; device keys persist for the same installed extension. Re-enter
keys only in options as needed. Upgrade/migration certification is not claimed.
