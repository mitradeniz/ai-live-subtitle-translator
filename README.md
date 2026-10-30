# AI Live Subtitle Translator

An open-source browser extension being developed for video subtitle translation.

**Current status:** a development build that displays accessible native HTML5 text
tracks after you enable it on a page, plus an experimental YouTube visible-caption
fallback. Includes saved preferences, JSON export, and
a dark glass settings interface. **Real translation, provider connections, and
API-key setup are not implemented.** A separate, clearly labeled local test build
repeats captions with a mock prefix for testing. YouTube live caption delivery still
needs owner verification; see the limitations below.

## Requirements

- Node.js 24.22.2 (LTS), pinned in `.nvmrc`.
- pnpm 11.28.10, pinned in `package.json`.
- Desktop Chrome 151 or newer. Automated browser checks use Chromium 151.0.7922.34;
  other browsers have not been verified.

## Build

From the repository root, using nvm if installed:

```sh
nvm install
nvm use
npm install --global pnpm@11.28.10
pnpm install --frozen-lockfile
pnpm check
```

With another version manager, select Node 24.22.2 first. The install hook generates
WXT's TypeScript configuration. Dependency versions and the lockfile are committed;
pnpm enforces a one-day release-age minimum and rejects unreviewed build scripts.
Build output and local caches are ignored by Git.

| Command                             | Purpose                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm build`                        | Production extension → `.output/chrome-mv3/`                                   |
| `pnpm build:mock`                   | Production-optimized local timing tool → `.output/chrome-mv3-mock/`            |
| `pnpm check:build`                  | Inspect production manifest, scripts, CSP, permissions, and mock exclusion     |
| `pnpm check:build:mock`             | Inspect the separate mock artifact                                             |
| `pnpm fixture`                      | Serve synthetic media at `http://127.0.0.1:4173`                               |
| `pnpm typecheck`                    | Generate WXT types and check strict TypeScript                                 |
| `pnpm lint`                         | ESLint, with no warnings allowed                                               |
| `pnpm format` / `pnpm format:check` | Write / check formatting                                                       |
| `pnpm test`                         | Unit tests for messages, credentials, sessions, cue timing, and cleanup        |
| `pnpm check`                        | Typecheck, lint, format, unit tests, production build and artifact check       |
| `pnpm test:browser`                 | Production credential/storage and UI browser tests                             |
| `pnpm test:youtube`                 | Test YouTube source/visible-caption behavior against routed synthetic fixtures |
| `pnpm test:playback`                | Build both variants and run the synthetic playback browser suite               |

## Load and use the extension

1. Run `pnpm build`. Open `chrome://extensions`, turn on **Developer mode**, click
   **Load unpacked**, and select `.output/chrome-mv3` from this repository.
2. Pin **AI Live Subtitle Translator**. On a regular webpage with a visible HTML5
   video and accessible text tracks, open the extension and choose **Enable
   captions**. This grants temporary access to that tab. It does not grant permanent
   access to all websites.
3. The overlay follows the video clock. **Disable captions** removes the overlay
   and restores native track modes. Caption text is rendered as plain text, including
   any markup-like strings present in the source.
4. **Open settings** opens the dark preferences page. Save the target language,
   display mode and font size, or export saved preferences as JSON without credentials.
   Save and re-enable captions to apply changes. Production uses original text while
   translation is unavailable, regardless of the saved translation display preference.
   The appearance preview uses fixed sample text.

After source edits, rebuild, click **Reload** on the extension card, refresh the video
page, and enable captions again. Reopen the settings tab to see UI changes. Managed
browsers may disallow unpacked extensions.

## Local timing lab

The fixture uses an original silent, 24-second generated test pattern and synthetic
WebVTT captions. Files are committed under the repository MIT license; no personal
video, key, public server or media download is required. See the
[fixture provenance and reproduction command](tests/fixtures/native/README.md).

```sh
pnpm build:mock
pnpm check:build:mock
pnpm fixture
```

Keep the fixture command running. Load `.output/chrome-mv3-mock` through **Load
unpacked**. Its name is **[TEST] Subtitle timing lab**. Disable the ordinary build
while testing to avoid two independent overlays. Open `http://127.0.0.1:4173`, click
this test extension, then **Enable mock captions**. This loopback origin and desktop `https://www.youtube.com/watch` pages
are accepted by the mock build; it requests the same temporary tab access as production.

The first cue is `Hello from the timing lab.` and the test output is
`[MOCK] Hello from the timing lab.`. **This is repeated test text, not a translation.**
The mock deliberately completes asynchronously after 120 ms. Original text remains
available while it is pending. With the default bilingual preference, both lines show.

Try play/pause, forward/backward seeks, 0.5×/2× speed, and disable/re-enable. At 6–8
seconds two cues overlap; at 9–10 and 18–20 seconds there is no cue. At 10–14 seconds
markup-like text should remain literal. The fixture also offers track replacement,
cue revision, video replacement, and same-page navigation. Replacing the video or
navigating stops the overlay; enable it again to resume. Reload resets the fixture.
Use **Container fullscreen** for the supported overlay path. Stop the server with Ctrl+C.

The normal build has no mock translator implementation or mock controls. Both variants
bundle scripts locally, use MV3, and make no translation-service requests. The mock
build is a test artifact and is not intended for store distribution.

## YouTube preview

Only desktop `https://www.youtube.com/watch?v=...` pages are recognized. Open a video,
turn on YouTube **CC**, and choose the original source track in YouTube's caption menu
(manual or auto-generated). In the extension popup, confirm **For YouTube: I selected
an original caption track, not Auto-translate**, then enable captions. Reopening the
popup resets this confirmation. Known Auto-translate selections and unknown player
metadata are blocked rather than silently used as a source.

The adapter first checks native timed tracks. If none are exposed, it reads only
YouTube's visible caption text and labels it **Visible captions · no cue timestamps**.
Observed text has revisions, not fabricated cue start/end times or future lookahead.
Incremental automatic captions can change while displayed. Source changes and seeks
clear stale work; the visible fallback waits for a fresh caption mutation afterward,
so the first changed line can be missed. YouTube's own captions remain untouched.

For mock evaluation, load the existing `.output/chrome-mv3-mock` build. It repeats
available text with `[MOCK]`; it does not translate. No fixture server or terminal
command is needed for this YouTube test. The ordinary production build shows only
original captions and status. No caption endpoint fetching is implemented.

During investigation, two public videos played and exposed source metadata but no
native text tracks. Two bounded credential-free timed-caption probes returned empty
200 responses; YouTube's own caption delivery was also empty in the isolated browser.
The packaged adapter was verified to identify the source and show **No accessible
caption text**, but **real visible-caption output has not been verified in that
environment**. Synthetic tests cover manual/automatic sources, language/track changes,
revisions, seek, empty text, malformed metadata, Auto-translate rejection and cleanup.
Selectors and the internal source-metadata API can change without notice.

If text is inaccessible, the extension reports that state and makes no translation
requests. Try another captioned video in your browser and report the result. Videos
without captions cannot be transcribed by this build. Next-video SPA navigation,
video replacement and source lifecycle changes stop the current overlay; explicitly
re-enable on the next video. Fullscreen/PiP limits described below still apply.

## Current playback limits

- One visible video in the main document: the largest by layout area is selected.
  Iframes, shadow-root players, inaccessible tracks,
  audio transcription, and arbitrary streaming formats are not supported here.
- The adapter selects a showing subtitle/caption track, otherwise the first available
  track. Native track changes are detected; there is no extension track picker yet.
  At most 32 tracks, 5,000 cues per selected track, 4,096 characters per cue, and four
  simultaneous cues are processed. Invalid cues are skipped.
- Caption boundaries use `video.currentTime`; snapshots detect cue edits at a 150 ms
  interval and on track events. Background tabs are subject to browser throttling.
  No latency benchmark or universal player compatibility is claimed.
- Fullscreen works when an ancestor container contains the video and overlay.
  Fullscreen on the video element itself, or Picture-in-Picture, stops the custom
  overlay and restores native track state. Re-enable after exiting. Other fullscreen
  mechanisms and Picture-in-Picture rendering are unsupported.
- Navigation (including changed SPA URLs), video source/replacement, extension context
  invalidation, or a 30-minute local session limit stops playback. Same-URL SPA changes
  that retain the same video/source need a later site-specific adapter.
- Worker restarts invalidate background session tokens. Already authorized local
  rendering uses its settings snapshot until cleanup/disable/expiry; it makes no
  background keepalive requests. Re-enabling obtains a new document-bound session.

## Permissions and data

The production manifest requests only `storage`, `activeTab`, and `scripting`. It
has no persistent/optional host grants, automatically registered content scripts,
web-accessible resources, or external message handlers. Injection runs in the
isolated world and targets the user-selected tab's main document. Incognito is disabled.
Executable code is bundled locally; extension CSP blocks remote connections. The
page's native track loader may load its own caption resources when a track is enabled.
No project backend, domain, provider account, or analytics is used. On YouTube only, a
packaged MAIN-world reader supplies bounded source metadata (video ID, language,
track ID/type and translation flag) through a validated, request-correlated DOM
event. It reads no caption text, caption URLs, credentials or cookies and makes no requests.
This page-controlled channel is untrusted data, never an authorization mechanism.

Messages are schema-validated and authorized from browser-supplied sender metadata.
Only the popup can request activation; it cannot supply a tab or document ID. The
toolbar popup is identified by its exact extension ID, origin and packaged URL;
Chrome may omit document metadata for this non-tab view. Content scripts still
require a complete tab/frame/document identity and an active document lifecycle. The
background uses Chrome's tab and injection results and binds a session to tab, frame,
document and origin. Content scripts receive safe preferences only. Only the options
page may mutate settings, export or manage credentials. No runtime message returns a key.

Local and session storage are restricted to trusted extension contexts before data
access. The credential abstraction defaults to session storage, with explicit device
retention and deletion. Session keys disappear on browser restart or extension
reload/update; worker restarts preserve them. Device storage is **not an encrypted
vault**. Tests use fake sentinel credentials; there is no key-entry UI yet.

## Browser checks and troubleshooting

Install Playwright's pinned Chromium once:

```sh
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:playback
pnpm test:youtube
```

Tests use fresh temporary profiles, never your personal browser. The security suite
checks preferences/export, forced worker restart, browser restart, credential deletion,
and denied content-script access through a temporary probe. The playback suite tests
both build variants, pause/seek/rate, overlap, literal text, track revision/replacement,
fullscreen, navigation, cleanup and responsive settings. Screenshots go to ignored
`test-results/`.

Playwright cannot invoke the real toolbar's temporary `activeTab` grant in this suite.
Playback tests therefore grant only the loopback fixture host to **temporary copies**
of the builds. They exercise the popup message boundary and document binding; manual
loading and clicking the real toolbar remain separate checks. Neither packaged build
contains that test host permission. Temporary profiles/server are removed on normal exit.
The YouTube suite routes every site request to original local fixture data at a
synthetic watch URL and grants YouTube access only to a temporary test copy. It tests
adapter behavior, not real YouTube delivery. These scoped regression checks are not
a security audit or certification.

The security and YouTube suites also open a real toolbar popup with
`chrome.action.openPopup()` to check its sender metadata and source-confirmation UI.
This exercises a different context from loading `popup.html` in a tab; it still
does not simulate the user's toolbar click granting `activeTab`.

If the extension card shows **Errors**, open it. Its **service worker** link opens
background diagnostics; an inactive worker is normal. Right-click the popup and choose
**Inspect**, or open DevTools in settings, for UI errors. Report browser/build version,
action, expected behavior, and redacted error text. Do not share keys or browser profiles.

## License

[MIT](LICENSE)
