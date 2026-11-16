# EmDash Exchange Online Email Plugin - Design Documents

EmDash の問い合わせフォームから Exchange Online 経由で通知メールを送信するプラグインについて、要件・基本設計をまとめた文書リポジトリです。

> **Status:** Design only / implementation not included. 文書内の `TBD` は実装開始前に確定が必要です。

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
