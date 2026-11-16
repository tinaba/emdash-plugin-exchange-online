# EmDash Exchange Online Email Plugin

EmDash の問い合わせフォームから Exchange Online 経由で通知メールを送るためのプラグインを目指すリポジトリです。現在提供しているのは Microsoft Entra ID 認証と Microsoft Graph `sendMail` のクライアント基盤であり、EmDash にインストールして使える完成済みプラグインではありません。

> **実装状況:** Microsoft Entra ID のトークン取得と Microsoft Graph `sendMail` クライアント基盤を実装済みです。EmDash Forms 連携、Cloudflare Worker、Queue/D1 処理は未実装です。以下の EmDash 設定手順は、互換性のブロッカー解消後に連携を実装・運用するための準備手順であり、現状のコードをそのまま EmDash に設定する手順ではありません。文書内の `TBD` は本番接続前に確定が必要です。

## Documents

1. [要件定義書](docs/requirements.md)
2. [基本設計書](docs/basic-design.md)

## Intended architecture

以下は設計上の目標構成です。現時点で動作する実装済みコンポーネントは「Current implementation」を参照してください。

- 実行基盤: Cloudflare Workers
- 非同期送信と再試行: Cloudflare Queues + DLQ
- 冪等性と送信状態: Cloudflare D1
- メール API: Microsoft Graph `sendMail`
- 認証: Microsoft Entra ID client credentials
- 認可: 専用メールボックスに制限した Exchange Online App RBAC
- 不正利用対策: Turnstile サーバー検証と粗粒度レート制限
- シークレット保管: Cloudflare Secrets
- データ最小化: Queue job は `submissionId` を参照し、本文や完全なメールアドレスをログに含めない

## Current implementation

- `src/graph-client.ts` implements tenant-specific client-credentials authentication, in-memory token caching, a single 401 refresh, fixed-mailbox Graph submission, and response classification.
- Graph `202` is represented as request acceptance only; it is not reported as final delivery.
- `npm test` and `npm run typecheck` validate this foundation. Node.js `>=22.6.0` is required.
- Production deployment, the EmDash plugin adapter, Queue/D1 processing, Turnstile integration, and operational runbooks remain pending. There is no Worker entry point, Wrangler configuration, or published/installable plugin package yet.
- The current Forms plugin email contract does not include a `submissionId`. Queueing its message would copy submitted personal data into the Queue, which the design forbids without separate approval. The integration must not be enabled until that boundary is resolved.

## Development setup

This repository currently contains a TypeScript Graph client foundation, not a deployable Worker or an EmDash plugin package.

```sh
npm ci
npm test
npm run typecheck
```

`GraphClient` accepts `tenantId`, `clientId`, `clientSecret`, `mailbox`, and `saveToSentItems`. The client validates the identity and mail inputs, gets a token for the tenant-specific Entra endpoint, and sends through the configured mailbox. Do not put real tenant credentials or personal data in tests, source code, or logs. These constructor options are not yet wired to Worker bindings or EmDash settings.

## EmDash setup and rollout

**現在は EmDash へインストール／登録できません。** EmDash plugin adapter、Worker entry point、配布パッケージ、Wrangler 設定がなく、現在の Forms の `email:deliver` 契約では Queue に安全に渡すための `submissionId` を得られません。実装済み Graph クライアントを直接 EmDash の設定画面へ登録したり、フォームのメッセージをそのまま Queue へ送ったりしないでください。

EmDash 連携を提供する際の準備・導入順序は次のとおりです。

1. **互換性とデータ境界を確定する。** 対象サイトの EmDash / Forms のバージョンと plugin API、`email:deliver` の Message / Context 型を実機で確認します。Forms から `submissionId` を安全に受け渡す方法を確立するか、本文を Queue に含める別方式について明示承認を得るまで、Adapter と送信経路を有効化しません。
2. **Microsoft 365 側を準備する。** 専用 Mailbox と Entra アプリケーションを用意し、Graph の `Mail.Send` アプリケーション権限を管理者同意のうえ Exchange Online App RBAC でその Mailbox に限定します。許可範囲内の送信成功と、範囲外 Mailbox への送信拒否を staging で確認します。
3. **Cloudflare 側の環境を作る。** Worker、Queues / DLQ、D1、Rate Limiting、Turnstile を環境ごとに用意し、Adapter 実装後にコードが要求する bindings を設定します。設計上の設定候補は [基本設計書](docs/basic-design.md) を参照してください。認証情報や Turnstile secret は Cloudflare Secrets に置き、Git、通常の `vars`、EmDash 設定、ログに保存しません。設計書の binding 名は現時点では実装済み設定ではありません。
4. **EmDash に Adapter を登録する。** 対象バージョンで検証した plugin API に従って配布パッケージを導入し、メール送信 transport として登録します。固定 From、許可リストの管理者宛先、フォーム別設定をサーバー側で構成し、秘密値を EmDash の設定には入力しません。パッケージ名、インストールコマンド、設定ファイル名は Adapter / 配布方式が実装された後に確定します。
5. **staging で契約・運用試験を行う。** 受付、Turnstile 失敗、入力拒否、二重処理、Graph の 202 / 401 / 403 / 429 / 5xx、再試行、DLQ、ログの個人情報除外を検証します。Graph の 202 は送信要求の受付であり、最終配送完了として表示しません。本番へ進む前に関連する `TBD` と受入条件を [要件定義書](docs/requirements.md) で確認してください。

### 構成値の扱い

| 値 | 想定する保管場所 | 状況 |
|---|---|---|
| Tenant ID、Client ID、Client Secret（MVP の場合） | Cloudflare Secrets | Graph クライアントが必要とする値。Worker binding への接続は未実装 |
| Turnstile secret | Cloudflare Secrets | Turnstile 連携は未実装 |
| 送信元 Mailbox、管理者宛先 allowlist、環境名 | 環境別 Worker vars / 管理者設定 | 固定送信元・宛先のポリシーを含め未実装 |
| `submissionId`、Queue / DLQ / D1 / Rate Limiting bindings | Cloudflare bindings | Producer / Consumer ともに未実装 |
| Client Secret、証明書秘密鍵、Turnstile secret | EmDash 設定、Git、ログ | **保存禁止** |

## Publication and licensing

- Repository content is licensed under the [Apache License 2.0](LICENSE).
- No third-party source code, binary, font, image, or Word file is included.
- Referenced upstream projects and documentation are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- The pre-publication inspection and residual risks are documented in [RELEASE_AUDIT.md](RELEASE_AUDIT.md).

## Important notes

- Microsoft Graph returning `202 Accepted` means the request was accepted; it is not proof of final message delivery.
- The actual EmDash version and `email:deliver` Message / Context types must be verified before finalizing the Adapter.
- The EmDash/Forms-to-Queue integration is blocked until the Queue payload can refer to a submission without copying personal data, or an alternative payload design receives approval.
- No real tenant ID, client ID, secret, mailbox, recipient, access token, or form submission data is included.

## Trademarks

EmDash, Cloudflare, Microsoft, Microsoft 365, Microsoft Entra, Exchange Online, and other product names may be trademarks of their respective owners. This repository is not endorsed by or affiliated with those owners unless separately stated.
