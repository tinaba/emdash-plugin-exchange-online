# 基本設計書

| 項目 | 内容 |
|---|---|
| 作成日 | 2026年11月16日 |
| バージョン | 1.0 |
| 対象 | EmDash 問い合わせフォーム向け Exchange Online メール送信プラグイン |
| 統合元 | 要件定義書 v1.1、Cloudflare Workers 実装設計書 v1.1 |

**目的**

> Azure Functions 等を追加せず、Cloudflare Workers と Microsoft Graph / Exchange Online を利用して、安全かつ運用可能なメール送信機能を実現する。

| **確定していない値** 本書中の「TBD」は実装開始前の決定事項です。仮のメールアドレス、EmDash バージョン、通知先、SLO 値を実環境値として扱わないでください。 |
|---|

## 1. 設計概要

EmDash 問い合わせフォームの受付処理と Exchange Online メール送信を Cloudflare Queues で分離する。Worker は Turnstile、入力、許可ポリシーを検証してメール送信 Job を Queue に投入し、Consumer が Microsoft Entra ID からアプリケーショントークンを取得して Microsoft Graph `sendMail` を呼び出す。D1 は冪等性と配送状態を保持する。

| **設計原則** 固定送信ポリシー、最小権限、非同期化、冪等性、秘密情報の分離、個人情報の最小化を基本とする。Graph の `202 Accepted` は要求受付であり、最終配送完了を示さない。 |
|---|

EmDash の実バージョンと `email:deliver` の Message / Context 型を確認するまで Adapter の型定義を確定しない。参考実装の互換表は参考情報とし、実環境で互換性を確認する。

## 2. システム構成

```text
[Browser]
  │ HTTPS + Turnstile token
  ▼
[EmDash / Cloudflare Worker]
  ├─ Forms / allowlist / validation
  ├─ Turnstile Siteverify
  ├─ Rate Limiting Binding
  ├─ D1: submission / delivery state
  └─ Queue Producer
       │
       ▼
  [Cloudflare Queue] ──► [Mail Consumer]
                            ├─ Secrets
                            ├─ Entra token endpoint
                            └─ Microsoft Graph sendMail
                                      │
                                      ▼
                              [Exchange Online]
                                ├─ Admin
                                └─ Auto-reply recipient

Failed after retry ──► [DLQ] ──► [Operations]
```

受付処理は Queue に Job が投入された時点で成功とする。Consumer は少なくとも 1 回配送される Queue を前提に、D1 の状態と Lease により重複送信を抑止する。

## 3. 論理コンポーネント

| コンポーネント | 責務 | 主なインターフェース |
|---|---|---|
| EmDash Forms / Adapter | フォーム送信とメール transport の接続、EmDash 型の変換 | Form submit、`email:deliver` 相当 |
| Contact API | Turnstile、入力、許可フォーム、レート制限の検証と受付応答 | HTTPS POST |
| Policy / Composer | 固定 From、許可済み To、Reply-To、件名、本文の生成 | 内部 `MailCommand` |
| Queue Producer | メール送信 Job の投入 | Cloudflare Queue binding |
| Mail Consumer | 冪等性、資格情報取得、Graph 送信、再試行と ACK | Queue consumer |
| Token Provider | client credentials によるトークン取得・キャッシュ | Entra token endpoint |
| Graph Gateway | `sendMail` 呼び出しと結果分類 | Microsoft Graph v1.0 |
| D1 Repository | 配送状態、Lease、監査メタデータの管理 | D1 SQL |
| Operations | DLQ、監視、資格情報更新、再処理 | Dashboard / Runbook |

## 4. 外部インターフェース

| IF-ID | 相手 | 方式 | 要求／応答 |
|---|---|---|---|
| IF-01 | Turnstile Siteverify | HTTPS POST | `secret`、`response`、任意の `remoteip`、`idempotency_key` → `success` / `error-codes` |
| IF-02 | Entra token endpoint | HTTPS POST form | `client_id`、`.default` scope、credential、`grant_type` → `access_token` / `expires_in` |
| IF-03 | Microsoft Graph | HTTPS POST JSON | `/v1.0/users/{MAIL_FROM}/sendMail` → `202` / `4xx` / `5xx` |
| IF-04 | Cloudflare Queue | Binding | `schemaVersion=1` の `MailJob`。at-least-once 配信 |
| IF-05 | EmDash email pipeline | Plugin interface | `email:deliver` 相当。実バージョンで確定 |

## 5. Cloudflare Bindings と設定

| Binding / 設定 | 型・保管先 | 秘密 | 用途 |
|---|---|---:|---|
| `MS_TENANT_ID` | Secret | Yes | Tenant 固有の token endpoint |
| `MS_CLIENT_ID` | Secret | Yes | Entra application ID |
| `MS_CLIENT_SECRET` | Secret（MVP のみ） | Yes | client secret。証明書方式採用時は廃止 |
| `MS_CERT_PRIVATE_KEY` | Secret（候補） | Yes | 証明書 JWT 署名。採用時のみ |
| `TURNSTILE_SECRET` | Secret | Yes | Siteverify |
| `MAIL_QUEUE` | Queue producer | No | 本番メール送信要求 |
| `MAIL_QUEUE` consumer | Queue consumer | No | Graph 送信 Worker |
| `MAIL_DLQ` | Queue | No | 最大試行回数超過 Job |
| `DB` | D1 | No | 冪等性・配送状態 |
| `FORM_RATE_LIMITER` | RateLimit | No | 60 秒の粗粒度制限 |
| `MAIL_FROM` | var | No | 専用 Mailbox |
| `ADMIN_RECIPIENTS` | var / 管理者設定 | No | 管理者宛先の許可リスト |
| `APP_ENV` | var | No | `dev` / `staging` / `prod` |

秘密値は Secrets に格納し、Git、通常の `vars`、EmDash 設定、ログに保存しない。ローカル開発用の `.dev.vars` / `.env` は Git の追跡対象外とする。

## 6. データ設計

### 6.1 内部型定義

```typescript
type MessageType = 'admin-notification' | 'auto-reply';

interface ContactSubmission {
  submissionId: string;
  formId: string;
  createdAt: string;
  name: string;
  email: string;
  category: string;
  body: string;
}

interface MailJob {
  schemaVersion: 1;
  correlationId: string;
  submissionId: string;
  formId: string;
  messageType: MessageType;
  attempt: number;
}

interface DeliveryResult {
  accepted: boolean;
  httpStatus: number;
  graphRequestId?: string;
}

interface EmailTransportAdapter {
  deliver(message: EmDashMessage, ctx: EmDashContext): Promise<void>;
}
```

`MailJob` には原則として本文、電話番号、完全なメールアドレスを含めず、`submissionId` から EmDash または D1 の正規化済みデータを取得する。参照データが取得できない場合に暗号化した最小ペイロードを採用するには、別途承認を要する。

### 6.2 D1 配送テーブル

```sql
CREATE TABLE mail_delivery (
  submission_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'QUEUED', 'PROCESSING', 'ACCEPTED', 'PERMANENT_FAILURE', 'DLQ'
  )),
  lease_until TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  graph_request_id TEXT,
  last_status INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (submission_id, message_type)
);
```

| 属性 | 内容 |
|---|---|
| 主キー | `submission_id` + `message_type` |
| `status` | `QUEUED` / `PROCESSING` / `ACCEPTED` / `PERMANENT_FAILURE` / `DLQ` |
| `attempt` | 試行回数 |
| `lease_until` | Consumer 異常終了時の処理回復用 |
| `graph_request_id` | Microsoft 側への問い合わせ用 ID |
| `last_status` | 直近の HTTP status |
| `created_at` / `updated_at` | 作成・更新日時 |

### 6.3 保持と個人情報

- D1 の配送テーブルに本文、電話番号、access token、client credential を保持しない。
- Queue は `submissionId` 参照方式を標準とし、個人情報の複製を避ける。
- ログのメールアドレスはマスクまたは一方向ハッシュとし、問い合わせ本文を記録しない。
- 参照元データの保持期間と Cloudflare / Microsoft 365 の Jurisdiction は TBD-05 で決定する。

## 7. メールポリシー

| 項目 | 管理者通知 | 自動返信 |
|---|---|---|
| From | 専用 Mailbox 固定 | 同左 |
| To | 管理者許可リスト | 形式検証済みの入力メール |
| Reply-To | 入力メール | 専用 Mailbox |
| Subject | 承認済みテンプレート＋種別／氏名 | 承認済み固定テンプレート |
| Body | エスケープ済み Text / HTML | エスケープ済み Text / HTML |
| CC / BCC | なし | なし |
| 添付 | なし | なし |
| `saveToSentItems` | 環境設定。本番は `true` を推奨 | 同左 |

EmDash Message の `to` / `from` / `replyTo` をそのまま信頼しない。From は `MAIL_FROM`、管理者 To は許可リスト、自動返信 To は形式検証済みの submission email に限定する。件名・本文は template ID と安全な変数から生成し、フォーム入力 HTML を直接採用しない。

## 8. 処理設計

### 8.1 フォーム受付

1. POST のみ受け付け、Content-Type と最大 body size を検査する。
2. `formId` を許可リストと照合する。
3. Turnstile token を Siteverify でサーバー検証する。`idempotency_key` は `correlationId` から生成する。
4. Schema によって入力を正規化し、メール形式、列挙値、文字数、制御文字を検査する。
5. Rate Limiting Binding で IP / formId ごとの粗粒度制限を適用する。
6. D1 に `submissionId` の受付・配送状態を一意に作成する。
7. 管理者通知 Job と、必要な場合のみ自動返信 Job を Queue に投入する。
8. Queue 投入成功後に受付応答（202 相当）を返す。Graph 送信完了は待たない。

Queue 投入に失敗した場合は受付成功とせず、利用者に情報を漏らさない 5xx 応答を返す。

### 8.2 EmDash Adapter

| 関心事 | 設計 |
|---|---|
| 登録 | 実バージョンが要求する plugin factory で `email:deliver` 相当の exclusive transport を 1 つ登録 |
| 型変換 | EmDash Message を内部 `MailCommand` に変換 |
| 許可 | From は `MAIL_FROM`、管理者 To は許可リスト、自動返信 To は検証済み submission email のみ |
| 件名・本文 | template ID と安全な変数から生成。入力 HTML を直接採用しない |
| 互換性 | 参考実装を参照し、staging で管理者通知、Reply-To、CC 無効化の結合テストを実施 |

EmDash のバージョンと `email:deliver` の Message / Context 型は、実環境で確認する。0.19+ / 1.x の参考実装だけで互換性を確定しない。

**実装前互換性確認（2026-11-16）**: EmDash 1.5.0 と `@emdash-cms/plugin-forms` 0.2.13 の公開実装を確認した。Forms は submission を保存した後に `ctx.email.send()` を呼ぶが、`email:deliver` に渡す値は `message` と `source` のみで、保存した `submissionId` を含まない。メッセージ本文には送信内容が含まれるため、そのまま Queue Job に格納すると本設計の個人情報最小化要件に反する。Forms が安定した submission 参照を transport に引き渡す方法、または承認済みの暗号化ペイロード方式が決まるまで、Queue Producer / EmDash Adapter の実装・有効化を保留する。現在のコードは独立して検証可能な Graph クライアント基盤に限定する。

### 8.3 正常系シーケンス

| Step | 処理 | 成功境界 |
|---:|---|---|
| 1 | Browser がフォームと Turnstile token を送信 | HTTP 受信 |
| 2 | Worker が Siteverify、schema、allowlist、rate limit を検証 | 検証 pass |
| 3 | D1 に受付・配送行を冪等作成 | 新規作成または既存確認 |
| 4 | 管理者通知と必要時の自動返信 Job を Queue に投入 | Queue 受領 |
| 5 | 利用者へ受付応答 | フォーム受付完了 |
| 6 | Consumer が Lease を取得して token を取得 | 処理権取得 |
| 7 | Graph `sendMail` を呼び出す | HTTP 202 = 要求受付 |
| 8 | D1 を `ACCEPTED` に更新して ACK | Consumer 完了 |

## 9. 認証・Microsoft Graph

### 9.1 Token Provider

```http
POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

client_id={clientId}
scope=https://graph.microsoft.com/.default
client_secret={secret}
grant_type=client_credentials
```

- Tenant ID を URL に入れる前に UUID 形式を検証し、`common` / `organizations` endpoint は使用しない。
- 秘密値を URL、例外、ログに含めない。
- access token は Worker isolate のメモリ内だけに保持する。
- `expires_in` の 5 分前または有効期間の 10% 前を目安に期限切れとして扱う。
- 同時更新は単一 Promise に束ねる（single-flight）。
- 401 時は cache を破棄して 1 回だけ再取得する。無限再試行はしない。
- 本番資格情報は証明書 / Federation を優先評価する。Secret を採用する場合は短期・ローテーション可能にする。

### 9.2 Graph sendMail

```http
POST https://graph.microsoft.com/v1.0/users/{encodedMailbox}/sendMail
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": {
    "subject": "[Web問い合わせ] <mapped category> - <safe name>",
    "body": {
      "contentType": "HTML",
      "content": "<escaped template>"
    },
    "toRecipients": [
      { "emailAddress": { "address": "<allowlisted admin>" } }
    ],
    "replyTo": [
      { "emailAddress": { "address": "<validated submitter>" } }
    ]
  },
  "saveToSentItems": true
}
```

| Graph 結果 | 分類 | 処理 |
|---|---|---|
| 202 | ACCEPTED | `accepted` として記録。配送完了とは表現しない |
| 400 | PERMANENT | payload / 設定不良。再試行せず DLQ・警告 |
| 401 | AUTH | token を 1 回更新後に再試行。再失敗は DLQ・緊急通知 |
| 403 | AUTHZ | 権限 / RBAC / From 不整合。再試行せず停止 |
| 404 | CONFIG | Mailbox / endpoint 設定不良。再試行せず停止 |
| 408 / 429 | TRANSIENT | `Retry-After` を優先。なければ backoff |
| 5xx / network error | TRANSIENT | 指数 backoff + jitter |
| その他の 4xx | PERMANENT | 再試行せず調査 |

## 10. Queue、再試行、冪等性

### 10.1 再試行方針

| 試行 | 目安 | 備考 |
|---:|---|---|
| 1 | 即時 | 初回 |
| 2 | 30 秒 | jitter ±20% |
| 3 | 2 分 | `Retry-After` 優先 |
| 4 | 10 分 | 同上 |
| 5 | 30 分 | 同上 |
| 超過 | DLQ | 自動再送しない。承認後に新 Job を作成 |

- Queue のプラットフォーム再試行とアプリ内 retry を二重化しない。Consumer は分類結果に応じて ACK / retry を選択する。
- D1 で `PROCESSING` Lease を取得する。`ACCEPTED` 済みキーは ACK のみ行う。
- 未知の `schemaVersion` は DLQ に移し、前方互換性を推測しない。
- 管理者通知と自動返信は別 Job とし、一方の失敗で他方を巻き戻さない。

### 10.2 状態遷移

| 遷移 | 条件 |
|---|---|
| `QUEUED` → `PROCESSING` | Consumer が Lease を取得 |
| `PROCESSING` → `ACCEPTED` | Graph 202 |
| `PROCESSING` → `QUEUED` | 一時失敗、再試行 |
| `PROCESSING` → `PERMANENT_FAILURE` | 再試行しない 4xx |
| 任意 → `DLQ` | 最大試行超過、未知 schema、参照データ欠落 |
| `ACCEPTED` → 変更なし | 重複 Job は送信せず ACK |

冪等性キーは `submissionId × messageType` とし、同じ処理の再実行による重複送信を抑止する。

## 11. 入力検証・レート制限

### 11.1 入力と不正リクエスト

- 氏名、メール、種別、本文を schema で正規化し、文字数と制御文字を検査する。
- CR/LF によるヘッダー注入を拒否する。
- From、管理者 To、CC / BCC、任意件名、任意 HTML を利用者入力から指定できないようにする。
- Turnstile の失敗、期限切れ、再利用を拒否する。
- 不正入力への応答で内部情報を漏らさず、詳細はログに出さない。

### 11.2 レート制限

Workers Rate Limiting Binding の `period` は 10 秒または 60 秒であり、カウンタはロケーション単位の近似値である。5 回 / 10 分や 3 回 / 30 分の厳密な窓を Binding のみで実装しない。

| 層 | 初期値 | 実装 |
|---|---|---|
| Edge 粗粒度 | IP ごと 5 回 / 60 秒 | RateLimit Binding。超過時 429 |
| フォーム単位 | formId ごと 30 回 / 60 秒 | RateLimit Binding |
| 長窓（必要時） | email hash ごと 3 回 / 30 分 | Durable Object 推奨。D1 を使う場合は競合許容を明記 |
| 全体保護 | 運用閾値 | Queue backlog / Graph 429 に応じた circuit breaker |

## 12. セキュリティ・ログ設計

### 12.1 セキュリティ

| 領域 | 設計 |
|---|---|
| 認証 | OAuth 2.0 client credentials。Tenant 固有 endpoint。資格情報は Secrets |
| 認可 | Graph Mail.Send と Exchange App RBAC で専用 Mailbox のみに制限 |
| Bot / 濫用 | Turnstile server validation、粗粒度 Rate Limit、必要時 DO 長窓 |
| 入力 | schema、長さ、列挙、CRLF、HTML escape、body size 上限 |
| メールポリシー | From / 管理者 To / CC / BCC / subject / template を利用者入力から分離 |
| 秘密管理 | Git / vars / EmDash 設定 / ログへ保存しない。環境分離・rotation |
| データ保護 | PII 最小化、マスク、Queue 参照方式、保持期間決定 |
| 監査 | 設定変更、資格情報更新、DLQ 再処理、RBAC テストを記録 |

### 12.2 構造化ログ

| Event | 主なフィールド | 記録禁止 |
|---|---|---|
| `contact.accepted` | correlationId, formId, submissionId, durationMs | 本文、電話、完全メール |
| `mail.queued` | submissionId, messageType | payload 本文 |
| `mail.attempt` | attempt, Graph status, request-id, durationMs | token、secret |
| `mail.accepted` | status=202, request-id | `delivered` という名称 |
| `mail.failed` | errorClass, sanitizedCode | Graph response 本文の無条件出力 |
| `mail.dlq` | reason, attempts, age | PII |

ログには correlationId、submissionId、messageType、試行回数、Graph status / request-id、処理時間を記録する。問い合わせ本文、電話番号、完全なメールアドレス、access token は記録しない。

## 13. 非機能・環境・運用設計

### 13.1 非機能要件

| 観点 | 設計値・方針 |
|---|---|
| 性能 | 受付 p95 2 秒以内を目標。Queue 投入までを対象とし、Graph 送信は非同期 |
| 可用性 | Queue で一時障害を吸収。最大 5 試行後に DLQ |
| 拡張性 | Worker / Queue の自動スケール。Graph throttling を尊重 |
| 可観測性 | 受付数、Queue backlog、202 率、4xx / 5xx、retry、DLQ、処理時間 |
| アラート | DLQ 滞留、401 / 403、Graph 5xx 急増、Queue age、資格情報期限 |
| バックアップ | D1 migration を管理。設定はコード化し、Secrets は別管理 |
| リリース | dev / staging / prod を分離し、段階展開と rollback を可能にする |
| Runbook | DLQ、資格情報、権限、Graph 障害、誤設定、rollback を用意 |

### 13.2 環境設計

| 項目 | dev | staging | prod |
|---|---|---|---|
| Mailbox | テスト Mailbox | 検証専用 | 本番専用 |
| Graph | 許可範囲内 | 許可範囲内 / 外テスト | App RBAC 限定 |
| Queue | 任意 | 有効 | 必須 |
| 自動返信 | 無効 | 許可宛先のみ | 設定で有効化 |
| Secrets | `.dev.vars` / `.env`（Git 除外） | Cloudflare Secrets | Cloudflare Secrets |
| Rate Limit | 緩和 | 本番相当 | 有効 |
| ログ | debug（PII 禁止） | info | info / warn |

## 14. テスト・デプロイ

### 14.1 テスト設計

| 種別 | 必須ケース |
|---|---|
| Unit | schema 境界、CRLF、escape、allowlist、Graph 分類、backoff、idempotency |
| Contract | EmDash `email:deliver` 型、Reply-To、Graph payload snapshot、D1 migration |
| Integration | Turnstile test key、Entra token、Graph staging Mailbox、Queue retry / DLQ |
| Security | From / To 注入、XSS、巨大 body、replay、secret scan、scope 外 Mailbox 拒否 |
| Resilience | 429 Retry-After、5xx、timeout、Queue duplicate、Consumer crash / Lease 回復 |
| Operations | 資格情報更新、rollback、DLQ 再処理、アラート、ログ PII 確認 |

### 14.2 デプロイ順序

1. D1 migration と Queue / DLQ を作成する。
2. 環境別 vars と required secrets 名を宣言する。
3. Secrets を CLI / 管理画面から投入する。
4. staging に deploy し、EmDash との連携テストを実施する。
5. Exchange App RBAC の範囲内 / 範囲外テストを実施する。
6. 障害注入と DLQ Runbook テストを実施する。
7. 段階的に本番 Traffic を有効化する。
8. メトリクスを確認後、旧経路を無効化する。

## 15. 未決事項・リリース判定

### 15.1 未決事項

| ID | 決定事項 | 基本設計への影響 |
|---|---|---|
| TBD-01 | EmDash / Forms の実バージョンと `email:deliver` の型定義・連携方法 | IF-05 Adapter interface |
| TBD-02 | 専用 Mailbox と表示名 | Graph path、From、App RBAC scope |
| TBD-03 | 管理者通知先・自動返信の初期設定 | Mail policy と template |
| TBD-04 | 本番資格情報：証明書 / Federation / 期限付き Secret | Token Provider、rotation |
| TBD-05 | Cloudflare データ所在地・保持期間 | Queue / D1 / ログ運用 |
| TBD-06 | SLO / 通知閾値 | 監視設定 |

### 15.2 リリース判定

| Gate | 条件 |
|---|---|
| G0 | EmDash の実バージョンと連携仕様、Mailbox、通知先、credential、Jurisdiction の TBD 決定 |
| G1 | token と Graph の疎通、App RBAC 範囲内成功／範囲外失敗 |
| G2 | Turnstile、入力、header injection、自動返信濫用テスト合格 |
| G3 | Queue retry、D1 冪等性、DLQ、障害注入、Runbook 演習合格 |
| G4 | 監視、アラート、rollback を確認後、本番 Traffic を有効化 |

## 16. 要件トレーサビリティ

| 要件群 | 基本設計章 |
|---|---|
| FR-001〜006 | §3、§7、§8、§11 |
| FR-007〜010 | §2、§6、§8、§10 |
| FR-011〜012 | §4、§9、§12、§15 |
| FR-013〜015 | §5、§8、§12〜§14 |
| NFR-SEC | §5、§6、§11、§12 |
| NFR-REL / PERF / LIM | §2、§8、§10、§11、§13 |
| NFR-OBS / PRI / OPS | §6、§12〜§15 |
| NFR-COMP | §4 IF-05、§8.2、§14、§15 |

## 参照資料

| 資料 | URL | 本書での利用 |
|---|---|---|
| Microsoft Graph user: sendMail | <https://learn.microsoft.com/graph/api/user-sendmail?view=graph-rest-1.0> | Mail.Send、`/users/{id}/sendMail`、202 Accepted の意味 |
| Microsoft Graph send mail process | <https://learn.microsoft.com/graph/outlook-things-to-know-about-send-mail> | 送信処理の非同期性と後続配送 |
| Exchange Online RBAC for Applications | <https://learn.microsoft.com/exchange/permissions-exo/application-rbac> | アプリ権限のメールボックス単位スコープ |
| Microsoft identity platform client credentials | <https://learn.microsoft.com/entra/identity-platform/v2-oauth2-client-creds-grant-flow> | client_credentials と .default scope |
| Cloudflare Workers Secrets | <https://developers.cloudflare.com/workers/configuration/secrets/> | 暗号化された Secret binding、ローカル開発 |
| Cloudflare Workers Rate Limiting | <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/> | 近似カウンタ、10 / 60 秒窓、ロケーション単位 |
| Cloudflare Turnstile server-side validation | <https://developers.cloudflare.com/turnstile/get-started/server-side-validation/> | Siteverify、5 分・単回利用 token |
| Cloudflare Queues configuration / DLQ | <https://developers.cloudflare.com/queues/configuration/configure-queues/> | 再試行、max_retries、Dead Letter Queue |
| EmDash Cloudflare email reference implementation | <https://github.com/tmyuu/emdash-cloudflare-email> | EmDash 0.19+ / 1.x の `email:deliver` 実装パターン |

参照日: 2026年11月16日。製品仕様は更新されるため、実装着手時に再確認する。

---

この文書は [Apache License 2.0](../LICENSE) の下で提供されます。製品名・商標は各権利者に帰属します。
