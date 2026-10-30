# AI Live Subtitle Translator

An open-source browser extension being developed for video subtitle translation.

**Current status:** a loadable development build with a popup and options page.
Subtitle detection and translation are not implemented. There are no API-key
fields, saved settings, or translation-provider connections yet.

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

| Command             | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `pnpm build`        | Build the production Chrome MV3 extension                   |
| `pnpm typecheck`    | Generate WXT types and check strict TypeScript              |
| `pnpm lint`         | Run ESLint with no warnings allowed                         |
| `pnpm format`       | Format source and public documentation                      |
| `pnpm format:check` | Check formatting without writing                            |
| `pnpm check:build`  | Inspect the generated entrypoints, CSP, and permissions     |
| `pnpm check`        | Run typecheck, lint, formatting, build, and artifact checks |

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
4. Click **Open settings**. A new tab should show **Settings** and
   **No settings to configure yet**. You can also reach it through the extension's
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

The production manifest requests no API or host permissions and declares no
content scripts. All executable code is packaged locally. Its content security
policy restricts scripts to the extension and blocks network connections.
This build does not read captions, store credentials, or contact external services.
No project server, domain, or provider account is needed to try it.

The build-inspection command is a narrow regression check, not a security audit
or proof of browser compatibility. Browser verification remains separate from a
successful build.

## License

[MIT](LICENSE)
