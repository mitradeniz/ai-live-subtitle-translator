# AI Live Subtitle Translator

An open-source browser extension being developed for video subtitle translation.

**Current status: 0.2.0-preview.1 — limited preview, not a fully verified beta.** This production build displays accessible native HTML5 text
tracks after you enable it on a page, plus experimental YouTube timed-caption access and a visible-caption
fallback. Includes saved preferences, JSON export, and
a dark glass settings interface, English/Turkish controls, and optional automatic activation on YouTube. **Experimental keyless Google translation is available after explicit opt-in.
Google Cloud and AI BYOK (OpenAI, DeepSeek, Gemini) have mocked contract/browser coverage; live playback verification remains incomplete. The owner reports a successful DeepSeek small test; that does not establish video translation.** A separate, clearly labeled local test build
repeats captions with a mock prefix for testing. YouTube live caption delivery varies; see the limitations below.

## Versioned owner preview

Read the [support matrix](docs/SUPPORT.md), [release notes](docs/RELEASE_NOTES.md),
[privacy notice](docs/PRIVACY.md) and [security contact](SECURITY.md). Paid-provider
live checks and hosted CI remain incomplete; this is an owner preview, not a store release.

After the pinned setup below, build and verify the extension-only archive:

```sh
pnpm release:package
pnpm exec playwright install chromium
pnpm test:release
pnpm check:reproducible
```

Packaging/verification requires the `unzip` command (macOS includes it; install it
on Linux if absent). WXT creates the ZIP; verification checks its exact root
inventory, CRCs and each file against the inspected normal build. SHA-256 and inventory
files sit beside the archive, outside it:

- `.output/ai-live-subtitle-translator-0.2.0-preview.1-chrome.zip`
- `.output/ai-live-subtitle-translator-0.2.0-preview.1-chrome.zip.sha256`
- `.output/ai-live-subtitle-translator-0.2.0-preview.1-chrome.inventory.json`

`check:reproducible` installs from the existing local pnpm store into a fresh temporary
source copy and compares rebuilt ZIP bytes. It needs the exact pinned Node/pnpm and
a completed initial install. This verifies same-toolchain/platform reproducibility,
not identical binaries across different operating systems or dependency versions.

For a clean owner install, create a separate Chrome profile, extract the ZIP into a
stable folder, then open `chrome://extensions` → Developer mode → Load unpacked and
select the extracted folder containing `manifest.json`. Check the displayed version
is **0.2.0-preview.1**. Keep any older test extension disabled in that profile. Open
its popup and **Open settings**; no engine or key should be configured. Unpacked
extensions at different paths may have different IDs/storage. See normal usage below.
To check the downloaded ZIP on macOS/Linux, run `shasum -a 256 -c` on its `.sha256`
file from the directory containing both files. A checksum detects accidental changes;
it is not a signature or store approval.

No upload or publishing command is included. Eventual submission needs an
owner-controlled [publisher account](https://developer.chrome.com/docs/webstore/publish)
and a public URL for the [privacy notice](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
A [static GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
can use its provided domain; no project backend or purchased domain is needed.
Hosting is not enabled. [Draft listing copy](docs/STORE_LISTING.md) and screenshots
from the actual settings UI are prepared locally, without inventing a live URL.

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
| `pnpm test:work`                    | Offline prefetch, cache, Retry-After and forced worker interruption checks     |
| `pnpm test:providers`               | Offline Cloud/DeepSeek/Gemini contracts, switching and quota browser checks    |
| `pnpm test:ai`                      | Offline-routed OpenAI contracts, UI, deletion and restart browser tests        |
| `pnpm test:google`                  | Offline-routed Google provider, fallback and cancellation browser tests        |
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
4. The popup offers provider cards, source/target language and
   original/translated/bilingual display directly. **Open settings** also offers
   font size, contrast, top/bottom position and English/Turkish interface language. **Save preferences**
   applies appearance changes during playback. Language or provider changes stop
   translation: enable captions again from the video page. In **Translation only**, the extension waits for the current translation without
   first displaying the source. Original/bilingual mode still shows source text
   while waiting. Provider failure or disabled translation restores originals.
   YouTube’s CC styling is restored when captions are disabled.
5. Click or focus the square glass control at the page edge to open quick settings.
   Change display mode, text size, contrast or position, or disable captions.
   Drag the control along either page edge (or use arrow keys), and use Hide/Show to collapse it. Focus remains visible;
   captions use automatic text direction for Arabic/Hebrew and other RTL text.
   The controls also work inside supported fullscreen containers. After choosing
   **Original only**, resume translation from the popup or settings; a page control
   cannot authorize restarting provider traffic.
6. In settings, expand **API keys and privacy** to configure accounts, delete keys
   or clear cached translations. **Export saved preferences** excludes credentials.
   No paid engine is selected or tested automatically.

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
The mock deliberately completes asynchronously after 120 ms. In bilingual mode, original text remains while the mock is pending; translation-only
waits without showing the original first. With the default bilingual preference, both lines show.

Try play/pause, forward/backward seeks, 0.5×/2× speed, and disable/re-enable. At 6–8
seconds two cues overlap; at 9–10 and 18–20 seconds there is no cue. At 10–14 seconds
markup-like text should remain literal. The fixture also offers track replacement,
cue revision, video replacement, and same-page navigation. Replacing the video or
navigating stops the overlay; enable it again to resume. Reload resets the fixture.
Use **Container fullscreen** for the supported overlay path. Stop the server with Ctrl+C.

The normal build has no mock translator implementation or mock controls. Both variants
bundle scripts locally and use MV3. Only the normal build can use translation providers after opt-in. The mock
build is a test artifact and is not intended for store distribution.

## Experimental keyless Google

Use the **normal build** (`.output/chrome-mv3`), not **[TEST] Subtitle timing lab**.
Open settings, choose target `tr` and bilingual display, and save. Under **Google ·
Experimental**, read the disclosure and click **Enable experimental Google**. Accept
Chrome's request for `translate.googleapis.com` access, then re-enable captions on
the video page. For the original local fixture (`pnpm fixture`), pause at one second:
`Hello from the timing lab.` should gain a Turkish line, such as
`Zamanlama laboratuvarından merhaba.` Google output can vary.

This sends caption text and source/target language choices to Google using an
undocumented endpoint. No API key, Google Cloud account, website cookies, video or
audio is used. Google Cloud's official paid/API-key service is a separate, explicitly selected integration described below. This mode has no availability guarantee; technical success
is not a store approval or confirmation of distribution rights. Google terms and
store disclosures need review before distribution.

**Disable Google and remove access** cancels work, clears translated overlays and
removes the host grant. Removing site access in Chrome has the same stop behavior.
Text already sent cannot be retracted. Re-enabling Google requires reactivating
captions. Original-only display sends no text. Preferences export does not export
provider consent; importing preferences must never imply consent.

The current language allowlist is `en`, `tr`, `de`, `fr`, `es`, `it`, `pt`, `ja`, `ko`,
`ar`, `ru`, `zh-CN`, and `zh-TW`, plus automatic source detection. Regional codes such
as `en-US` and `pt-BR` map to their base language; `zh-Hans`/`zh-Hant` map to simplified/
traditional Chinese. Unsupported codes show an error and retain originals.

Limits are deliberately conservative: one job globally, at most four cues per job,
1,000 characters per cue, 32 KiB response, 4,000 translated characters per cue,
eight-second request timeout, at least one second between requests, 20 requests per
fixed minute window and 200 per browser/extension session. Counters survive service
worker restarts; browser restart or extension reload starts a new session. Each cue
uses its own request to preserve alignment; completed batches use the bounded cache described below. Transient failures have finite retries and cooldown. Observed rolling text waits 300 ms before dispatch; timed cues do not use this delay. Dense captions and overlapping
cues may stay original when limits or timing prevent completion.

HTTP 401/403 stops further Google requests for that browser session. HTTP 429 observes Retry-After and a persistent cooldown; it does not bypass throttling. The extension
does not bypass challenges, rotate hosts, use a proxy or fall back to a paid provider.
Timeouts, invalid responses, missing permission and local limits have visible overlay
messages. Source changes, seek, navigation and disable cancel work; stale responses
cannot replace current captions. Completed translated batches are stored in a bounded session cache; device persistence is opt-in, as described below.

## Select a translation engine

The popup shows the selected provider, destination, saved-key checkmarks and current
page status. Click Google or a provider with a saved key to select it, grant the
selected host if needed, then **Enable captions**. Selecting a card does not change
**Original only** mode: choose a translation mode and save, or use Enable captions
to apply the edited preferences. No key is tested automatically.

A checkmark means **key saved**, not verified connectivity or sufficient balance.
There is one saved AI profile/key (OpenAI, DeepSeek or Gemini) plus a separate Cloud
key. Unconfigured cards open settings; switching AI origins there replaces the old
AI key. Keys are entered/deleted only in settings. The YouTube source confirmation
appears on watch pages and is not remembered across popup openings.

The popup distinguishes an active overlay from translation that needs restarting.
A green **✓ Enabled** button confirms activation; **Restart captions** applies
changed preferences. A missing paid-provider key blocks activation and shows
**Add API key**. **Key saved** badges show device or session retention explicitly.
Session keys are cleared by extension reload; choose **Remember this new key on
this device** when entering a replacement if you want it to survive reload.

The popup shows pending work and the most recent current-caption result/error for the active tab,
when available, with elapsed queue/provider time for the last completed request.
This is not evidence that a translation is still visible for the current cue. This local summary expires after five minutes and is lost when the
worker restarts or the session is invalidated; it is not a full playback history.
Provider errors retain original captions and never silently choose a paid fallback.

In **Open settings**, the **Translation engine** section also offers:

- **Google · Experimental · No key** uses the undocumented keyless service.
- **Google Cloud · Your key · Provider billing** uses official Translation Basic v2.
- **AI · Your key and model** uses the saved OpenAI, DeepSeek or Gemini profile.
- **Original captions only** disables translation without removing saved keys or grants.

Configure the appropriate key/profile below, choose an engine and click **Apply engine**.
Chrome requests only that engine's host access. The provider cards' **Use … for captions**
buttons make the same explicit selection. No paid engine is selected by default; upgrades
preserve an existing explicit selection. Failures never select another provider.

Changes to the engine, profile, key or language cancel pending work and clear translated
results. The overlay switches to **Original captions**, with instructions to open the
extension popup and choose **Enable captions** again. This stop message is not a quota
error or evidence that a paid request succeeded. Refresh the video tab after extension reload.

## Google Cloud Translation Basic v2

Create or use your own Google Cloud project with billing and Cloud Translation API
configured, following Google's [Basic setup guide](https://docs.cloud.google.com/translate/docs/setup).
Enter the key under **Google Cloud · Your API key**, then **Save Cloud key**. Saving
makes no network request. Select Google Cloud and approve `translation.googleapis.com`.
**Run small Cloud paid test** sends only `Hello, world.` from English to Turkish when clicked, with at most one retry after an explicit rate-limit response. It may incur provider charges. Then activate captions on an English video
with target `tr` and bilingual display. A valid test response is not a quality benchmark.

The adapter uses [Basic v2 translate](https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate),
`format: text`, and NMT. Multiple strings are mapped to their original cue IDs/revisions
in request order; missing/extra results are rejected. API keys are sent using the
[documented `x-goog-api-key` header](https://docs.cloud.google.com/docs/authentication/api-keys-use),
never query parameters. Errors and diagnostics never return raw response text or keys.
Cloud storage is separate from the AI key; no Gemini key or keyless mode is used implicitly.

The current Cloud language subset is `en`, `tr`, `de`, `fr`, `es`, `it`, `pt`, `ja`,
`ko`, `ar`, `ru`, `zh-CN`, `zh-TW`, `he`, `id`, `nl`, `pl`, `uk`, `hi`. Regional codes
map to their base language; `zh-Hans` maps to `zh-CN`, `zh-Hant`/`zh-HK` to `zh-TW`,
legacy `iw` to `he` and `in` to `id`. Source `auto` omits the source field. Unsupported
codes are rejected locally. Output remains literal text, including markup-like text
or entity strings; nothing is inserted as HTML.

## AI with your own key

Under **AI · Your API key**, choose a reviewed profile:

| Provider | Supported model                                     | Exact HTTPS endpoint                                                       |
| -------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| OpenAI   | `gpt-5.4-mini-2026-03-17` (default), `gpt-5.4-mini` | `https://api.openai.com/v1/chat/completions`                               |
| DeepSeek | `deepseek-flash`                                    | `https://api.deepseek.com/chat/completions`                                |
| Gemini   | `gemini-3.8-flash`                                  | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` |

These are specific supported contracts, not universal endpoint/model compatibility.
Model IDs cannot be mixed between providers. Other hosts, HTTP, URL credentials,
paths, queries and fragments are rejected. Model/account availability is provider-controlled.
Sources: [OpenAI model](https://developers.openai.com/api/docs/models/gpt-5.4-mini),
[DeepSeek reference](https://api-docs.deepseek.com/api/create-chat-completion/),
[Gemini compatibility](https://ai.google.dev/gemini-api/docs/openai).

1. Choose the AI provider/model. Changing the dropdown clears any unsaved key input.
   **Saving a different origin deletes the previously saved AI key**, even if you
   selected Remember. There is one active AI key slot, not a vault of vendor keys.
2. Enter that provider's key and choose **Save AI profile and key**. The input clears;
   saving makes no request. An empty input preserves an existing key only when its
   origin still matches. Save changes before enabling/testing the profile.
3. Choose **Use [provider] for captions**, or select **AI** → **Apply engine**.
   Approve only the displayed recipient host. There is no automatic key test.
4. Click **Run small paid test** once. The only source is `Hello, world.` with an
   English-to-Turkish instruction. API usage and charges/quota belong to your account.
5. On the video page, enable captions again. Expect the selected provider and destination
   in the overlay, originals while waiting, then Turkish text if the request succeeds.
   On YouTube, use original-source CC and confirm the source in the popup.

AI requests include only the bounded current cue batch (IDs, revisions and text) and
language choices. Context is limited to other cues in the same batch. No previous
transcript, page URL, audio, video, website cookies, tools or prompt secrets are sent.
The key is in the Authorization header only. OpenAI uses strict structured output with
`store: false` and reasoning off. DeepSeek uses documented JSON-object mode, a JSON
example and thinking disabled; whitespace-only output is rejected. Gemini uses its
OpenAI-compatible endpoint with JSON schema and low reasoning. All outputs undergo
the same local ID/revision, size, refusal and completion validation and plain-text rendering.
No blanket zero-retention promise is made; each provider's data policies apply.

## Paid-provider limits and recovery

Cloud and AI each allow one request at a time (including their explicit test), at
most four 1,000-character cues/request, 10 requests/fixed minute, 100/browser-extension
session, >=1s interval, 15s timeout, 64KiB response and 4,000 output characters/cue.
AI generation is capped at 2,048 tokens/request. AI profiles share the AI budget;
Cloud has its own budget. Limits survive worker restarts; browser/extension restart
starts a new session. There is no automatic provider fallback. Bounded lookahead, cache and retry behavior are described below.
These safeguards are **not a billing cap**. Dense or short captions may stay original.

Errors identify the next action without exposing provider messages:

- **Key/account access:** check the key, API activation, key restrictions and billing.
- **Quota/balance:** check the provider account; never repeatedly test to exhaust quota.
- **Language/configuration:** select a supported language/profile and re-enable captions.
- **Permission:** restore access explicitly in settings; then re-enable captions.
- **Network/invalid response:** originals remain; try an explicit test after resolving
  connectivity, or explicitly choose a different engine.

Key/access and quota failures stop that paid engine for the browser session. After
fixing the problem, explicitly saving the key clears the stop but not spent request
budgets. Disabling/re-enabling does not reset budgets. No live quota-exhaustion test
is performed. A service-worker restart restores unexpired document-bound sessions. Interrupted paid work is not replayed automatically; extension reload still requires enabling captions again.

**Delete AI key / Delete Cloud key** removes both session and device copies and
cancels work. **Disable … and remove access** stops work and removes that host grant;
the key remains until deleted. Selecting another engine does not automatically revoke
previously granted hosts. Removing permissions in Chrome stops active translation, including cache delivery.
Already transmitted text and accepted provider charges cannot be retracted.

Keys default to trusted session storage: worker sleep preserves them, browser restart
or extension reload/update clears them. **Remember this new key on this device**
explicitly opts a newly entered key into durable local storage; it is not encrypted
by this extension. Origin mismatch or corrupt AI profile invalidates the AI key.
Exports contain only caption preferences, never keys, profiles or engine selection.

Automated paid-provider checks use fake keys and offline responses. Live account
access, translation quality and latency remain owner checks for OpenAI, Google Cloud,
DeepSeek and Gemini. No project server, proxy, shared key or purchased domain is needed.

## Scheduling, cache and interrupted requests

Accessible native and YouTube timed tracks prioritize the current cues and prepare up to **20 seconds**
ahead after activation, including while paused. The window holds at most **12 cues**, dispatching at most **four
cues / 2,000 characters** per batch, with current cues separate from future batches.
Pause before enabling captions to let this bounded window prepare before playback.
Prefetch can consume quota for captions you later skip; pause does not disable translation.
Use Disable captions to stop preparation. The visible YouTube fallback has no future-caption lookahead; its 300 ms
stabilization remains separate. Request spacing applies to actual dispatch starts;
cache hits and cancelled waiters do not restart the spacing delay. Rapidly revised text can still miss translation.

The background queue holds at most 16 jobs across tabs and two per tab, with one
active job per provider. Waiting current-cue jobs precede prefetch jobs. Completed
identical batches are reused; duplicate job IDs share one operation. Provider rate
budgets still apply, including tests/retries. Queue work expires after 25 seconds;
seek, track changes, disable, tab closure and settings changes discard stale results.

`Retry-After` accepts delay seconds or an HTTP date; the extension never shortens
that delay. In-operation waits above five seconds become cooldown instead of keeping
an old cue waiting. Keyless transient failures get at most two retries, with exponential
backoff and jitter. Paid requests get at most one retry after an explicit rate-limit
response, and **no automatic retry on network/timeout uncertainty**. Three consecutive
transient failures open a minimum 30-second cooldown. Malformed output, invalid keys,
quota/balance denial and permission failures do not retry. New relevant cues can resume
after cooldown; no heartbeat or keepalive loop runs in the background.

**Translation cache** in settings defaults to trusted session storage: at most 128
batches / 256 KiB, expiring after 30 minutes. **Remember translations** opts into a
separate device cache with the same bounds and a 24-hour expiry. Expired entries are
ignored and pruned when accessed; least-recently-used entries are evicted. Device
translations survive browser restart; session translations do not. No private/incognito
session is supported or persisted. Cached translations are not encrypted or anonymous.

Cache identity includes endpoint, provider/config version, model, languages, ordered
batch text/context, prompt/glossary version and output options. Keys, source URLs and
raw provider responses are excluded. Changing provider, model, language or context
cannot reuse an incompatible result. **Clear translation cache** clears both stores
and stops active translation. **Delete saved data and keys** additionally removes keys,
preferences, AI profile and playback sessions, turns translation off and disables
persistent caching. Host grants remain until removed through provider controls/Chrome.
Spent provider budgets and minimal uncertain-request guards remain for this session
to avoid turning a clear action into repeated paid dispatches.

Before dispatch, bounded job metadata is checkpointed in trusted session storage:
identity hash, tab/session, job ID, generation, attempt count and expiry, without a
key or caption payload. Playback sessions retain browser-derived document/frame/origin
binding and a 30-minute expiry. Content can reconnect once with the same job ID after
a messaging interruption; it cannot grant itself a session. A completed result can be
returned from cache. Uncertain paid batches are suppressed for 30 minutes even with a
new job ID; subsequent unrelated cues can proceed. An interrupted keyless job may be
resumed once (within its provider retry/rate limits). Closed tabs and expired work are
dropped. Browser restart/extension reload clears session state. **Exactly-once provider
billing is not guaranteed**: a service may accept a request before the worker stops.

Run `pnpm test:work` for a reproducible, entirely offline fixture with sentinel keys.
It measures cold caption/cache-seek timing and a Retry-After gap, tests 2x playback,
repeated seeks, disconnect/reconnect and worker termination during a paid request.
It stops the worker through Chromium's browser-level service-worker control and detaches
immediately; an attached worker inspector can change lifecycle behavior. This forced
termination check is not a claim that natural idle suspension was measured. Fixture
response timings are not live-provider latency or billing guarantees.

## Page translation and writing tools

Open the extension popup on a regular HTTP(S) page and choose a provider using the
existing provider cards. **Customize translation** enables page translation, selected
text, Alt-hover previews, text-field translation and AI Writing separately. Video
caption controls have their own visibility switch. Optional text tools start off.
Provider/model and source/target languages are shared with captions; page display
mode and enabled tools are separate.

- **Translate visible page** translates visible ordinary text. Scrolling exposes the
  next text to translate; it does not send the whole document in advance. Choose
  bilingual or translated-only page display. Links retain their original elements.
- **Show the logo on all sites** asks once for HTTP(S) access across websites.
  With that explicit grant, the idle logo appears across supported websites after
  refresh/navigation and browser restart until you turn the switch off. It does not
  start translation. Chrome's first permission prompt cannot be skipped; subsequent
  sites need no individual grant while that permission remains active. Restricted
  browser pages and incognito are excluded; nonstandard-port sites remain manual-only.
  Turning this off stops all automatic logos, including older per-site choices.
  Chrome's host grant stays available to other features; remove it in Chrome if desired.
- **Always show the logo on this site**, under Customize translation, retains the
  narrower one-host alternative. You can use this instead of all-sites access.
- **Enable edge tools** installs the page control without transmitting text. Clicking
  the square starts the chosen action (page, video subtitles, selection, field or
  writing); hovering opens its glass menu. Clicking an already running page/video
  action does not stop or restart it; use Restore/Disable from the menu.
  The hover menu also lets you choose Page or Video directly; the choice is saved,
  but switching it never starts translation or enables a disabled feature. Focus/F2 opens
  the menu by keyboard, Escape closes it, and arrow keys move the dock. Hide/Show
  preserves its page edge and height. **Change provider / languages** opens the
  trusted toolbar popup; keys and new provider permissions stay in extension UI.
  For the video click action, select Video subtitles in Customize translation and
  confirm an original YouTube track there when applicable. Choose a provider and
  translated/bilingual caption display first; original-only is not silently changed.
- **Selected text**: enable tools first, select up to 1,000 characters, then choose
  Translate selection or use that edge-button action. Output appears in a preview.
- **Hover**: opt in, then hold Alt while hovering over ordinary text for 650 ms.
  Hovering over the edge control alone never sends text.
- **Text fields**: focus a normal textarea or text/search input, then explicitly
  choose Translate focused field. Review the result and choose Apply. Password,
  known payment/account fields and rich contenteditable editors are excluded.
- **AI Writing**: select a configured AI profile, enter a short text/brief or focus
  a supported field, then choose improve, shorten, formal tone or draft from brief.
  Generate preview is a provider request and can cost money. The extension never
  clicks a send/submit button; Apply writes only to the unchanged original field.
  For other editors, copy the plain preview yourself.

Restore original page stops pending page work and restores owned text changes.
The popup's Restore action also removes page tools. Provider/language/feature/key
changes restore the page. Opted-in sites restore the idle logo automatically;
translation still requires a new click. Navigation or expiry ends the translation
session; automatic mode reconnects idle controls without resuming translation. Page translation and caption sessions are authorized separately.
If both tools are enabled, the page menu's Video controls opens the caption controls.
With page tools enabled, a smaller **A文** button also appears inside the largest
visible main-document video, above its native controls. It opens translation tools;
choose **Start video subtitles** to start captions, **Video controls** for an active
caption overlay, or **Open settings** for provider setup. Opening this menu sends
no text. This button is an overlay, not a modification of the site's toolbar.
It follows scroll, player replacement and supported container fullscreen.

Popup provider controls load independently of page-status replies. A busy page can
show **Page status unavailable** while settings remain usable. Refresh the page to
reconnect. Native track changes are polled at a bounded interval to avoid feedback
loops with player libraries that also manage caption visibility.

This is an experimental main-document feature, not support for every site/editor.
Iframes, shadow-root text, PDFs, browser-internal pages, code, forms, hidden text,
`translate="no"` and editable areas are excluded from automatic translation.
It examines at most 12,000 DOM nodes / 1,500 text parent elements in small batches, processes at most 300 text
nodes / 60,000 source characters per activation, and skips individual nodes over
6,000 characters. Inline markup can split translation context. Highly dynamic
sites may replace translated nodes; changed originals are never blindly overwritten
on restore. Provider failures pause work with originals retained for unfinished text.
Existing provider rate/quota limits still apply; no automatic paid fallback or
unbounded retry is added. Page results/drafts stay in page memory, not the optional
persistent caption cache. Feature preferences survive reload; page activation does not.

Run `pnpm test:page` for the packaged synthetic page/selection/field/writing tests.
After `pnpm build`, `node tests/browser-lesson.mjs` checks a large synthetic lesson,
player track feedback, the in-video button and unresponsive page-status handling.
The test uses mocked providers and a temporary test-only host grant. Live provider
quality, actual activeTab prompts and site/editor compatibility remain owner checks.

## Floating subtitle controls

After enabling captions, a small square glass **A/文** control appears at the page edge.
Drag it vertically along either page edge; it stays on the nearest left or right
side of the viewport, staying in place when the page scrolls. Captions remain attached
to the video. Left/Right arrow keys choose the edge; Up/Down adjust its height. The Show
controls tab returns at the same edge and height. Click the square to change display
mode, text size, contrast or top/bottom placement. Escape closes the panel. **Hide
controls** collapses it into a **Show controls** tab without stopping translation.
**Open settings** opens the extension's fixed options page; keys and provider setup
stay there. Resuming a stopped/original-only translation still requires the trusted
popup. Disable captions removes the widget and restores native caption styling.

In bilingual mode the translated line is above the original. On YouTube the native
CC layer is temporarily transparent while the extension paints a replacement at its
position; the original DOM still supplies fallback text. Original inline opacity is
restored on disable or unavailable source. Burned-in text cannot be removed by this
extension. Custom overlays still cannot appear in video-element fullscreen or PiP.

## YouTube preview

Only desktop `https://www.youtube.com/watch?v=...` pages are recognized. Open a video,
turn on YouTube **CC**, and choose the original source track in YouTube's caption menu
(manual or auto-generated). In the extension popup, confirm **For YouTube: I selected
an original caption track, not Auto-translate**, then enable captions. Reopening the
popup resets this confirmation. Known Auto-translate selections and unknown player
metadata are blocked rather than silently used as a source.

For advance YouTube captions, choose **Allow YouTube and turn on** under automatic
captions in settings, grant the YouTube-only permission, then **refresh the video
page once**. Select the original CC track and your translation engine before
playing. The early reader must be present when the player first loads its captions;
manual activation after the player has cached them may be too late. Pausing briefly
after activation gives the selected provider time to prepare upcoming text.

The adapter prefers native timed tracks, then reads the selected original track's
**player-owned caption response**. It observes only the exact YouTube timed-text
path for the current video/language/track; it never rewrites requests or responses,
extracts tokens, replays signed URLs, or generates authentication material. If the
player advertises its caption reload option, it requests that reload once per
source. Some players reuse their own cache without another network response;
automatic access plus a page refresh handles the initial capture instead.

Complete timed pieces are joined until sentence-ending punctuation, subject to
12-second / 800-character / eight-piece limits. Long unpunctuated speech uses
bounded phrases. Manual overlaps remain separate; rolling ASR sentence display is
clipped at the next sentence's supplied start. No word timestamps are invented.
The complete prepared unit appears at its first source cue's start, and the
translation is above the original in bilingual mode. An incomplete visible DOM
fragment no longer triggers a translation request.

**YouTube timed track · advance translation** identifies available timed data.
**Advance translation unavailable** means it was not obtained; the visible fallback
cannot provide future words. It translates only complete punctuated visible text,
so unpunctuated fallback captions may remain untranslated. This is not a guarantee
of support for every video or live stream. Empty/unsupported platform responses
stop cleanly. No speech recognition, hidden proxy or paid fallback is involved.

The isolated signed-out browser observed player-owned XHR/json3 requests but empty
responses; live delivery in that environment remains unavailable. Synthetic
packaged tests verify early capture/reuse, original response preservation, complete
sentences, timing, source changes and cleanup. These tests do not establish live
provider latency or universal YouTube compatibility. The player contract can change.

If text is inaccessible, the extension reports that state and makes no translation
requests. Try another captioned video in your browser and report the result. Videos
without captions cannot be transcribed by this build. Next-video SPA navigation and video replacement stop the current overlay. With
manual activation, enable again on the next video. The optional automatic setting
can start a fresh, document-bound session after navigation or player replacement. Fullscreen/PiP limits described below still apply.

## Automatic captions on YouTube

This is off by default and available only for `https://www.youtube.com/*` in the
normal build. In settings, confirm that you use original YouTube captions, then
choose **Allow YouTube and turn on** and accept Chrome's site permission. The
extension can then start on watch pages after refresh, next-video navigation or
video replacement. Choose your translation engine first: activation may send
captions to that provider and use your quota. Auto-translate/unknown source tracks
remain blocked, even when this setting is on.

**Disable captions** in the popup or overlay pauses automatic activation for that
tab until refresh or manual enabling. **Turn off and remove access** in settings
stops affected playback and unregisters the automatic script. You can also revoke
YouTube site access through Chrome's extension controls. Permission denial is
recoverable by trying again; permission is rechecked before activation and when the
worker starts. Other sites can separately opt in to an idle page logo; this never enables
automatic captions outside YouTube. The mock build
retains manual activation only.

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
- Worker restarts recover valid document-bound sessions from session storage.
  Browser restart or extension reload clears them. There is no worker keepalive;
  automatic site observers send messages only when the URL/video changes.

## Permissions and data

The production manifest requests only `storage`, `activeTab`, and `scripting`. It
has no install-time host grants, static content scripts, web-accessible resources,
or external message handlers. On explicit YouTube opt-in, it registers a packaged
runtime content script for that exact optional origin; opt-out unregisters it.
Injection runs in the isolated world and targets the authorized main document. Incognito is disabled.
Executable code is bundled locally. Production CSP permits connections only to
`https://translate.googleapis.com`, `https://api.openai.com`, `https://translation.googleapis.com`,
`https://api.deepseek.com` and `https://generativelanguage.googleapis.com`. Only the selected
provider’s optional host permission is requested on selection. YouTube site access
is a separate optional grant for automatic captions.
The mock build has no optional provider host and blocks remote connections. The
page's native track loader may load its own caption resources when a track is enabled.
No project backend, domain, shared key, or analytics is used. Cloud and AI modes require your own provider account/key and API quota. On YouTube only, a
packaged MAIN-world reader supplies bounded source metadata and normalized timed
captions through validated, request-correlated DOM events. With explicit automatic
site consent it starts at document start. It observes only selected original-track
XHR/fetch responses and ignores redirects or mismatched video/language/track data.
A one-MiB response limit, 200,000 text-character limit, 5,000-cue limit and bounded
reader/request counts apply. Provider requests still omit credentials and reject
redirects; YouTube's own requests retain the website's normal behavior unchanged.
Signed URLs are neither persisted nor sent to the background/providers/logs/exports.
Disabling removes response observers; a single normalized track may remain in page
memory for up to 30 minutes for re-enable. Navigation, closing the page, site opt-out
or clearing all extension data removes it. No reader code receives provider keys.

This page-controlled channel is untrusted data, never an authorization mechanism.

Messages are schema-validated and authorized from browser-supplied sender metadata.
Only the popup can request manual activation; it cannot supply a tab or document ID.
The automatic watcher can request activation only from a browser-identified YouTube
watch document after explicit site consent and a current host grant. The
toolbar popup is identified by its exact extension ID, origin and packaged URL;
Chrome may omit document metadata for this non-tab view. Content scripts still
require a complete tab/frame/document identity and an active document lifecycle. The
background uses Chrome's tab and injection results and binds a session to tab, frame,
document and origin. Content scripts receive safe preferences only. Only the options
page may export or manage credentials. Popup/options may change viewing preferences
and select a reviewed engine. An already bound content session can update only
bounded appearance fields or stop itself; it cannot change languages, providers,
endpoints or keys. No runtime message returns a key.

Local and session storage are restricted to trusted extension contexts before data
access. The credential abstraction defaults to session storage, with explicit device
retention and deletion. Session keys disappear on browser restart or extension
reload/update; worker restarts preserve them. Device storage is **not an encrypted
vault**. Tests use fake sentinel credentials. Enter real keys only in the options UI, never in a bug report or chat.

## Browser checks and troubleshooting

Install Playwright's pinned Chromium once:

```sh
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:playback
pnpm test:youtube
pnpm test:google
pnpm test:ai
pnpm test:providers
pnpm test:work
pnpm test:controls
pnpm test:gate
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

The multi-provider suite (`pnpm test:providers`) is always offline: it routes synthetic
Cloud, DeepSeek, Gemini and keyless Google responses. It covers explicit selection,
origin-bound key replacement, delayed-request switching, literal text, invalid keys
and a mocked 429 quota failure. It cannot consume real provider quota.

The AI suite is always offline and uses sentinel keys with routed Chat Completions
responses. It covers explicit test, literal Unicode/markup output, malformed results,
authentication stop, cancellation on deletion, worker/browser restarts and retention.
Its temporary build grants only the fixture and OpenAI hosts; real optional-host
prompts/removal and real account usage remain manual checks.

The Google suite is offline by default and routes synthetic provider responses.
Its temporary copy has fixture and provider host grants; Chrome's optional-host
confirmation/removal dialog remains a manual check on the normal build. The explicit
`node tests/browser-google.mjs --live` variant permits one real request containing
the original synthetic fixture caption. It is not part of routine checks or CI.

If the extension card shows **Errors**, open it. Its **service worker** link opens
background diagnostics; an inactive worker is normal. Right-click the popup and choose
**Inspect**, or open DevTools in settings, for UI errors. Report browser/build version,
action, expected behavior, and redacted error text. Do not share keys or browser profiles.

The controls suite (`pnpm test:controls`) uses only routed synthetic responses. It
checks keyboard navigation, live appearance changes, focus retention, Turkish UI,
RTL/plain text, and YouTube registration/refresh/navigation/manual-stop/opt-out.
Its temporary copy has scoped fixture/YouTube/provider grants; actual Chrome
permission denial/revocation prompts remain manual checks.

The glass translation mark is original repository artwork in `assets/logo.svg`.
Chrome uses the committed PNG sizes under `public/icons/`. After changing the SVG,
run `pnpm icons` with the pinned Playwright Chromium installed, then rebuild.

The packaged gate suite exercises Chromium redirect and CSP enforcement, response
size limits, malformed model output, repeated authentication failures, and storage
initialization failure in a fresh worker. It uses a temporary copy with scoped host
grants and a test-only initialization fault; no real API request is sent.

For the complete CI-equivalent command sequence and dependency review process,
see [CONTRIBUTING](CONTRIBUTING.md). Read [SECURITY](SECURITY.md) before reporting
sensitive issues. Builds include third-party notices and a dependency inventory
collected from emitted modules; see [license provenance](third-party/README.md).

## License

[MIT](LICENSE)

Observed captions ending in sentence punctuation settle for 120 ms; rolling fragments
keep a 300 ms debounce. Provider spacing, quotas and retry limits are unchanged.
A cancelled queue wait no longer holds up cached results. These changes cannot
remove provider latency or add future captions to the YouTube DOM fallback.
