# Firefox build and review instructions

Firefox desktop uses a separate Manifest V3 artifact. The minimum is Firefox 153
for browser-provided document IDs; integration checks were run on Firefox 159.0
on macOS 27.0.1 arm64. Other platforms and the minimum version need separate
browser verification. Android is not advertised.

## Build from the source archive

Install Node.js **24.22.2** and pnpm **11.28.10**, as pinned in `package.json`.
Extract the source archive, open a terminal in its root, then run:

```sh
pnpm install --frozen-lockfile
pnpm release:firefox
```

The archive is `.output/ai-live-subtitle-translator-0.2.2-firefox.zip`; the unpacked
files are in `.output/firefox-mv3`. The command checks the actual manifest, local
scripts, CSP, allowed inventory and ZIP/build alignment and writes a SHA-256 file.
The source archive contains the original TypeScript, React components, styles,
lockfile, license notices and synthetic tests. No secret or project backend is
required to build it. No downloaded executable extension code is used at runtime.

## Review and tests

```sh
pnpm check
pnpm test:firefox
```

`FIREFOX_BINARY` can select an installed Firefox binary. The default on macOS is
`/Applications/Firefox.app/Contents/MacOS/firefox`. The Firefox harness uses its own
disposable profiles. A child-process-only automation setting permits WebDriver
BiDi to inspect extension pages; no personal browser profile, certificate override
or disabled add-on signature validation is used.

The production build is tested unchanged for popup/options, trusted settings,
credential deletion/export and session/device retention across extension reload.
A separate temporary copy simulates explicit loopback/provider host grants and
uses a local synthetic provider to check caption timing, cleanup and content-script
boundaries. That test-only provider and its grants are absent from the release.
Mock text is not evidence of live translation quality or provider availability.

There is no project login. To try live translation without a key, select experimental
keyless Google in settings, explicitly grant its host, and enable captions or page
translation on accessible content. This undocumented Google integration can fail.
Optional OpenAI, DeepSeek, Gemini and Google Cloud profiles need your own key,
provider account and quota; no shared reviewer key is supplied.

YouTube needs original CC. Advance caption capture requires explicit automatic
YouTube access and a refresh before playback. Restricted pages, iframe players,
Picture-in-Picture and video-element fullscreen are unsupported. See
[SUPPORT.md](SUPPORT.md) and [PRIVACY.md](PRIVACY.md).

Settings screenshots contain fixed illustrative caption preview text. They do not
claim a live provider result. This release is a limited preview, not a security
certification or a promise of universal site/browser compatibility.
