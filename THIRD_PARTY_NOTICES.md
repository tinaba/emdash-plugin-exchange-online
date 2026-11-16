# Third-Party Notices

## Scope

This repository contains design documentation only. It does **not** vendor or redistribute third-party source code, binaries, fonts, images, or generated assets. API names, configuration identifiers, product names, URLs, and short factual summaries are used for interoperability and attribution.

## Referenced open-source projects

| Project | Use in this repository | Upstream license | Upstream notice |
|---|---|---|---|
| [EmDash](https://github.com/emdash-cms/emdash) | Target CMS and plugin API reference | MIT | No upstream code is copied into this repository. |
| [`@emdash-cms/plugin-forms`](https://www.jsdelivr.com/package/npm/@emdash-cms/plugin-forms) | Forms plugin named in the design | MIT | No package content is distributed here. |
| [emdash-cloudflare-email](https://github.com/tmyuu/emdash-cloudflare-email) | Architectural reference for an EmDash email provider | MIT, copyright Yushi Matsui | No upstream code is copied into this repository. |

The MIT License permits use, modification, publication, distribution, sublicensing, and sale, subject to preservation of its copyright and permission notice when copies or substantial portions are redistributed. Because no upstream code is redistributed here, no MIT-licensed payload is bundled. The links above provide the authoritative upstream notices.

## Referenced vendor documentation

The documents cite Microsoft Learn, Cloudflare documentation, and EmDash documentation. The repository contains original summaries and API identifiers, not substantial reproductions of those pages. Each design document includes direct source links.

## Future implementation requirement

If implementation code or assets are added, the release process must:

1. generate a dependency inventory/SBOM;
2. record exact package versions and licenses;
3. preserve all required copyright, attribution, and NOTICE text;
4. review copyleft, source-available, non-commercial, and trademark terms separately; and
5. rerun secret, PII, binary, and provenance scans before release.
