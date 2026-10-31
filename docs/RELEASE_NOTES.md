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
