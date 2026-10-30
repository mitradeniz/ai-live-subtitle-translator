# AI Live Subtitle Translator

An open-source browser extension being developed for video subtitle translation.

**Current status:** a loadable development build with a popup, saved subtitle
preferences, and settings export. Subtitle detection and translation are not
implemented. API-key setup and provider connections are not available in the UI.

## Requirements

- Node.js 24.22.2 (LTS), pinned in `.nvmrc`.
- pnpm 11.28.10, pinned in `package.json`.
- Desktop Chrome 151 or newer for this development build. Other browsers have not
  been verified yet.

## Build

From the repository root, using nvm if installed:

```sh
nvm install
nvm use
npm install --global pnpm@11.28.10
pnpm install --frozen-lockfile
pnpm check
```

If you use another Node version manager, select Node 24.22.2 before running the
remaining commands. The install hook generates WXT's TypeScript configuration.
The production unpacked extension is written to `.output/chrome-mv3/`.

| Command             | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `pnpm build`        | Build the production Chrome MV3 extension                               |
| `pnpm typecheck`    | Generate WXT types and check strict TypeScript                          |
| `pnpm lint`         | Run ESLint with no warnings allowed                                     |
| `pnpm format`       | Format source and public documentation                                  |
| `pnpm format:check` | Check formatting without writing                                        |
| `pnpm check:build`  | Inspect the generated entrypoints, CSP, and permissions                 |
| `pnpm test`         | Run storage, message authorization, and session boundary tests          |
| `pnpm test:browser` | Build and test the extension in isolated Chromium profiles              |
| `pnpm check`        | Run typecheck, lint, formatting, unit tests, build, and artifact checks |

Dependency versions and the lockfile are committed. pnpm enforces a one-day
release-age minimum and fails on unreviewed dependency build scripts. Dependency
changes require an explicit install; validation commands do not silently install
packages. Build output and local caches are ignored by Git.

## Try it in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this repository's `.output/chrome-mv3`
   directory, which contains `manifest.json`.
3. Pin **AI Live Subtitle Translator** from Chrome's extensions menu and open it.
   The popup should say **Early development** and explain that translation is
   not implemented.
4. Click **Open settings** to adjust the target language code, display mode, and
   font size. **Save preferences** persists them locally; **Export saved preferences**
   downloads the saved values as JSON without credentials. These preferences do not
   enable translation yet. You can also reach settings through the extension's
   **Details → Extension options** entry.

After editing code, run `pnpm build`, click **Reload** on the extension card in
`chrome://extensions`, and reopen the popup and settings tab. This build has no
content scripts and does not change video pages.

If Chrome shows an **Errors** button on the extension card, open it for details.
The card's **service worker** link opens background logs; an inactive worker is
normal because this build has no ongoing work. Right-click the open popup and
choose **Inspect** for popup errors, or open DevTools in the settings tab.
Report the build version, Chrome version, expected behavior, and error text;
remove any personal information first. Managed browsers may restrict developer mode.

## Permissions and data

The production manifest requests only `storage`, for local preferences and the
credential-store foundation. It has no host permissions or content scripts;
incognito use is disabled. Executable code is packaged locally, and CSP blocks
network connections. No project server, domain, or provider account is needed.

Messages are schema-validated and authorized from browser-supplied sender metadata.
Only the options page can change settings or manage credentials. A content-script
session must match its browser tab, frame, document, and origin. There is no runtime
message that returns an API key or grants itself a session. Sessions expire and
are invalidated when the background worker restarts.

Both local and session storage are restricted to trusted extension contexts before
the background reads or writes them. The credential abstraction defaults to session
storage, with explicit device retention and deletion. Session keys disappear on
browser restart or extension reload/update; worker restarts preserve them. Device
storage is **not an encrypted vault**. Settings export excludes credentials.
This build has no live provider integration or API-key entry form; tests use fake keys.

The build-inspection command is a narrow regression check, not a security audit
or proof of browser compatibility. Browser verification remains separate from a
successful build.

## Browser security checks

Install Playwright's Chromium once, then run the separate browser suite:

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

The suite uses fresh temporary profiles, never your personal profile. It checks
preferences/export, forced worker restart, browser restart, and credential deletion
against the production build. To test content-script isolation before a real site
adapter exists, it adds a loopback-only probe to a temporary copy of the extension.
That probe and its site access are never added to the production manifest. All
credentials are sentinel values; no translation services are contacted. Temporary
profiles and the loopback server are cleaned up when the test exits normally.

Browser checks use Chromium 151 through pinned Playwright 1.62.1. They verify a
specific set of boundaries, not security certification or compatibility with every
browser. `pnpm check` runs the browser-independent checks; the browser suite is separate.

## License

[MIT](LICENSE)
