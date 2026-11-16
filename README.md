# EmDash Exchange Online Email Plugin

EmDash の問い合わせフォームから Exchange Online 経由で通知メールを送信するプラグインです。

> **Implementation status:** Microsoft Entra token acquisition and Microsoft Graph `sendMail` client foundation are implemented. The EmDash Forms-to-Queue integration is not yet implemented; see the verified compatibility constraint below. 文書内の `TBD` は本番接続前に確定が必要です。

## Documents

1. [要件定義書](docs/requirements.md)
2. [基本設計書](docs/basic-design.md)

## Architecture summary

- Runtime: Cloudflare Workers
- Asynchronous delivery and retries: Cloudflare Queues + DLQ
- Idempotency and delivery state: Cloudflare D1
- Mail API: Microsoft Graph `sendMail`
- Authentication: Microsoft Entra ID client credentials
- Authorization: Exchange Online RBAC for Applications, restricted to a dedicated mailbox
- Abuse controls: Turnstile server validation and coarse-grained rate limiting
- Secret storage: Cloudflare Secrets
- Data minimization: Queue jobs reference `submissionId`; message bodies and complete email addresses are excluded from logs

## Current implementation

- `src/graph-client.ts` implements tenant-specific client-credentials authentication, in-memory token caching, a single 401 refresh, fixed-mailbox Graph submission, and response classification.
- Graph `202` is represented as request acceptance only; it is not reported as final delivery.
- `npm test` and `npm run typecheck` validate this foundation.
- Production deployment, the EmDash plugin adapter, Queue/D1 processing, Turnstile integration, and operational runbooks remain pending.
- The current Forms plugin email contract does not include a `submissionId`. Queueing its message would copy submitted personal data into the Queue, which the design forbids without separate approval. The integration must not be enabled until that boundary is resolved.

## Publication and licensing

- Repository content is licensed under the [Apache License 2.0](LICENSE).
- No third-party source code, binary, font, image, or Word file is included.
- Referenced upstream projects and documentation are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- The pre-publication inspection and residual risks are documented in [RELEASE_AUDIT.md](RELEASE_AUDIT.md).

## Important notes

- Microsoft Graph returning `202 Accepted` means the request was accepted; it is not proof of final message delivery.
- The actual EmDash version and `email:deliver` Message / Context types must be verified before finalizing the Adapter.
- No real tenant ID, client ID, secret, mailbox, recipient, access token, or form submission data is included.

## Trademarks

EmDash, Cloudflare, Microsoft, Microsoft 365, Microsoft Entra, Exchange Online, and other product names may be trademarks of their respective owners. This repository is not endorsed by or affiliated with those owners unless separately stated.
