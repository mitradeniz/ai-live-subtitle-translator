# Contributing

Use the Node and pnpm versions pinned in `.nvmrc` and `package.json`. Install with
`pnpm install --frozen-lockfile`. See [README](README.md) for loading the extension
and running the synthetic playback fixture.

Before submitting a change:

```sh
pnpm check:repository
pnpm check
pnpm build:mock
pnpm check:build:mock
pnpm exec playwright install --with-deps chromium
pnpm test:packaged
pnpm audit --audit-level=high
pnpm release:package
pnpm test:release
pnpm check:reproducible
```

Archive verification additionally needs the system `unzip` command.
`check:reproducible` compares a fresh offline frozen install/build against the
current ZIP using the existing pnpm store; no node_modules or browser profile is reused.

`test:packaged` uses the two existing builds, isolated browser profiles, sentinel
credentials and mocked provider responses. It never enables the Google suite's
explicit live mode. Browser tests run Chromium with its sandbox enabled; do not
use your personal profile or disable browser security to make a test pass.
Actual host permission dialogs, site delivery and real paid account behavior
require separate manual checks. An attached worker inspector can affect worker
lifecycle; the interruption fixture detaches after stopping the worker.

Keep changes focused and explain the observable behavior and verification in the
pull request. Use imperative English commit subjects, such as
`fix(playback): discard results after a track switch`. Do not commit API keys,
browser profiles, logs, build output or local planning notes. Use original or
redistributable captions/media in fixtures, never signed URLs or account state.

Runtime messages and page bridge data are untrusted. Changes to authorization,
provider destinations, persistence, batching or permissions need meaningful boundary
regressions and review of the generated artifact. Caption/model output must stay
plain text. Tests must not intentionally consume paid quota or require CI secrets.

GitHub Actions runs frozen installs, static checks, unit tests, both builds,
advisory checks and packaged browser tests, followed by ZIP verification and a clean install test. Actions are pinned to full commit
SHAs; checkout does not persist credentials. PR jobs have read-only repository
permissions, no project secrets and no publish step. Do not change these jobs to
`pull_request_target` or execute PR code in a privileged workflow.

Dependabot proposes npm and Actions updates weekly; no automatic merging is
configured. Review upstream changes, licenses, action commits, lifecycle scripts,
lockfile changes and generated output before accepting updates. Keep the pnpm
version in CI synchronized with `packageManager`. A new bundled dependency may
require updating the reviewed supplemental notices in [third-party](third-party/README.md).
Assess advisories for severity and reachability; do not force incompatible upgrades
just to clear a scanner. The CI audit threshold blocks high/critical findings;
moderate/low findings still require human review. Passing tests or scans is not
proof of security or store approval.
