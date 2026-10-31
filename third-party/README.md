# Packaged license notices

The build collects modules actually emitted by Vite across WXT entrypoints, then
writes `THIRD_PARTY_NOTICES.txt` and `dependency-provenance.json` into each build.
Installed package notices are used unchanged. The build fails when a bundled
package lacks a license declaration or notice, unless its exact version has a
reviewed supplemental notice below. Dependency updates must revisit these mappings.

These MIT packages omit the license file from their npm tarballs. The original
texts were retrieved from their official repositories on 2026-10-31:

| Package                | Notice          | Upstream source                                                                                                                                                                    |
| ---------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| wxt 0.21.5             | wxt-LICENSE     | [wxt-v0.21.5](https://github.com/wxt-dev/wxt/blob/e690f91730aa679a58fba905f30f8ca80ea4f490/LICENSE)                                                                                |
| @wxt-dev/browser 0.3.7 | browser-LICENSE | [WXT repository commit](https://github.com/wxt-dev/wxt/blob/5c31bc80c8537dc24b0121b8c4d39d6569c87646/LICENSE); packages/browser/package.json at this commit declares 0.3.7 and MIT |

The generated inventory describes distributed modules, not every development
dependency. Checksums identify the included notice text; they are not a security
attestation. The project itself is covered by the root LICENSE.

Additional bundled notices:

- `@wxt-dev/storage@1.3.0`: [storage-v1.3.0 license](https://github.com/wxt-dev/wxt/blob/7c44f51a6bb968cf9e7766d398f8bcbc4fa1d0b2/LICENSE), stored unchanged in `storage-LICENSE`.
- This storage distribution prebundles `dequal/lite@2.0.3`, identified in its source region header. Its [v2.0.3 license](https://github.com/lukeed/dequal/blob/37d4f27de03fa6264e406cd03288cec8255fca4c/license) is included separately as `dequal-LICENSE`. Review nested bundled dependencies when updating WXT storage; a module inventory alone cannot discover them.
