# Third-Party Notices

## Scope

This repository contains original TypeScript implementation and design documentation. It does **not** vendor or redistribute third-party source code, binaries, fonts, images, or generated assets. API names, configuration identifiers, product names, URLs, and short factual summaries are used for interoperability and attribution.

## Referenced open-source projects

| Project | Use in this repository | Upstream license | Upstream notice |
|---|---|---|---|
| [EmDash](https://github.com/emdash-cms/emdash) | Target CMS and plugin API reference | MIT | No upstream code is copied into this repository. |
| [`@emdash-cms/plugin-forms`](https://www.jsdelivr.com/package/npm/@emdash-cms/plugin-forms) | Forms plugin named in the design | MIT | No package content is distributed here. |
| [emdash-cloudflare-email](https://github.com/tmyuu/emdash-cloudflare-email) | Architectural reference for an EmDash email provider | MIT, copyright Yushi Matsui | No upstream code is copied into this repository. |

The MIT License permits use, modification, publication, distribution, sublicensing, and sale, subject to preservation of its copyright and permission notice when copies or substantial portions are redistributed. Because no upstream code is redistributed here, no MIT-licensed payload is bundled. The links above provide the authoritative upstream notices.

## Development dependencies

The lockfile contains only development, type-checking, and linting dependencies; they are not bundled into the implementation. The direct entries are:

| Package | Locked version | Use | License |
|---|---:|---|---|
| `typescript` | 5.9.3 | Type checking and `npm run build` | Apache-2.0 |
| `@types/node` | 22.20.5 | Node test-runner types | MIT |
| `eslint` | 10.15.0 | `npm run lint` | MIT |
| `typescript-eslint` | 8.73.0 | TypeScript parser and rules for ESLint | MIT |
| `undici-types` | 6.21.0 | Transitive Node type dependency | MIT |

`eslint` and `typescript-eslint` were added on 2026-11-17 after explicit approval (§15 dependency review) to make `npm run lint` available as described in §G11. They bring 95 transitive packages, so the resolved tree is 98 packages. All of them are MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, or BlueOak-1.0.0, and all are already covered by the allowlist in `.github/scripts/license-audit.mjs`; that script prints the per-license breakdown on every run and fails the build if a package falls outside it.

## Referenced vendor documentation

The documents cite Microsoft Learn, Cloudflare documentation, and EmDash documentation. The repository contains original summaries and API identifiers, not substantial reproductions of those pages. Each design document includes direct source links.

## Future implementation requirement

Before implementation code is published, and whenever dependencies or assets change, the release process must:

1. generate a dependency inventory/SBOM;
2. record exact package versions and licenses;
3. preserve all required copyright, attribution, and NOTICE text;
4. review copyleft, source-available, non-commercial, and trademark terms separately; and
5. rerun secret, PII, binary, and provenance scans before release.
