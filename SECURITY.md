# Security and data handling

This project is an early development Chromium extension, without an external
security certification or store approval. No supported long-term release line or
response-time guarantee has been established.

Only enable translation on pages whose captions you are comfortable sending to
the selected provider. Keyless Google is experimental and sends text in a request
URL; Cloud and AI send text in request bodies. Provider processing/retention policies
still apply. There is no project backend, telemetry service or shared API key.

Keys default to browser session storage. Explicit device retention stores them in
local extension storage, which is not an encrypted vault. Both storage areas are
restricted to trusted extension contexts before access. Only options can manage
credentials; no message returns keys. Session keys survive worker suspension, but
not browser restart or extension reload/update. Settings export omits keys.
Persistent translation caching is optional and expiring; it can contain caption
text. Clear keys/cache from settings before sharing a machine/profile. Incognito
operation is disabled. See [README](README.md) for exact storage and permission controls.

Provider endpoints are fixed HTTPS profiles, require explicit host access, and reject
redirects. No page-supplied URL can trigger privileged fetching. Provider failures
retain original text; they do not silently switch to another paid engine. Local
request budgets and retry limits reduce accidental costs but are not a billing cap
or a guarantee of exactly-once billing after interrupted requests.

The page and its DOM remain untrusted, including the overlay controls. A bound
content session may adjust appearance or stop translation, but cannot restart it
from original-only mode; resume using the extension popup or settings. It cannot
read credentials or change providers, endpoints or languages. Caption and model
output is displayed as text. Do not interpret a model's caption output as trusted
instructions.

Choosing the video edge action in the popup or authorized hover menu delegates caption activation
to that document's page-tools session. The background derives tab/document identity
from the browser sender, checks the selected capability and existing provider setup,
and bounds repeated activation. This action cannot enable a provider or change
original-only display; YouTube source confirmation comes from trusted preferences.
The compact player switch uses the same enabled-caption capability and bound sender
checks without changing the edge action. Status reads cannot start a provider;
turning it off revokes playback work and pauses automatic captions for that tab.
Local VTT export reads only already-loaded source cues, escapes text, rejects
ambiguous/oversized input and never accepts a URL or fetches remote captions.
The content-side action picker is limited to enabled page/video features, uses a
bound document session, and cannot modify other settings or source confirmation.
Automatic logo access requires a saved opt-in plus a current browser grant. The
all-sites switch explicitly requests HTTP(S) wildcard access; the narrower per-site
option remains available. Registrations follow the chosen authorized scope. Showing
controls or renewing an expired idle session never starts translation.

## Reporting and fixes

Do not post keys, authorization headers, personal captions, signed URLs or full
browser profiles in issues. For ordinary bugs, include build/browser version,
reproduction steps using synthetic captions, expected behavior and redacted errors.

Report suspected vulnerabilities privately to **mitradenizkaratas@gmail.com**.
This owner-designated address also accepts privacy questions. Send a minimal
reproduction using synthetic data, affected version and impact; never send API
keys, browser profiles or personal captions. No response-time SLA is promised.

A security fix should include a focused regression test, inspection of both built
variants and retesting of affected browser behavior. Review dependency advisories
and upstream changes rather than automatically applying forced upgrades. Before
distribution, maintainers must publish accurate
privacy disclosures, verify applicable store/provider terms and complete the
remaining real-browser/account checks. Build an archive from the inspected normal
extension output only; never archive the repository or the mock test build.
