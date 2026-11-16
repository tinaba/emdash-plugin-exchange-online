# 要件定義書

**目的**

> Azure Functions 等を追加せず、Cloudflare Workers と Microsoft Graph / Exchange Online を利用して、安全かつ運用可能なメール送信機能を実現する。

| **確定していない値** 本書中の「TBD」は実装開始前の決定事項です。仮のメールアドレス、EmDashバージョン、通知先、SLO値を実環境値として扱わないでください。 |
|----|

## 1. エグゼクティブサマリー

問い合わせフォームの送信後、EmDashから管理者通知と問い合わせ者への自動返信をExchange Online経由で送信する。実行基盤はCloudflare Workers、メール送信はMicrosoft Graph sendMail、認証はMicrosoft Entra IDのアプリケーション権限を使用する。秘密情報はソースコードおよびEmDash管理画面に保持しない。

**本番リリース方針** 本番ではCloudflare Queuesを経由し、フォーム受付とメール送信を分離する。Graphの202 Acceptedは「要求受付」であり、最終配送完了ではない。 |
|----|

## 2. 目的・成功条件

| **ID** | **目的／KPI** | **判定** |
|----|----|----|
| OBJ-01 | Cloudflare中心の構成でExchange Onlineから送信 | Azure Functions等の常設中継サービスなし |
| OBJ-02 | オープンリレー化を防止 | 利用者入力でFrom、管理者To、CC/BCC、任意件名／HTMLを指定不可 |
| OBJ-03 | 秘密情報をコードから排除 | CI、Git、通常vars、EmDash設定に秘密値なし |
| OBJ-04 | 受付と送信障害を分離 | 本番はQueue受領後に受付成功を応答し、一時障害は再試行 |
| OBJ-05 | 追跡可能性を確保 | submissionId／correlationIdで受付・送信・失敗を関連付け |

## 3. スコープ

### 3.1 対象

- EmDashフォーム送信を契機とする管理者通知
- 問い合わせ者への自動返信（フォーム単位で有効／無効）
- Microsoft Graphのアプリケーション権限による送信
- Cloudflare Workers、Secrets、Turnstile、Rate Limiting、Queues、D1を用いた運用
- 固定送信元・管理者宛先、許可済みフォーム、テンプレートの管理者設定
- 監査可能なメタデータログと再試行／DLQ運用

### 3.2 対象外

- 初期リリースでの添付ファイル
- 利用者が指定する任意宛先・CC・BCC・From
- 一斉配信、マーケティングメール、ニュースレター
- 完全な配送保証／開封確認／バウンス自動処理
- 汎用SMTPリレー、Azure Functions、Azure Storageの常設利用
- 任意HTMLテンプレートの公開編集

## 4. 利用者・責任分界

| **主体** | **責務** |
|----|----|
| サイト訪問者 | フォーム入力、Turnstile完了、送信結果の受領 |
| EmDash管理者 | 許可フォーム、通知先、テンプレート、機能ON/OFFの管理 |
| Cloudflare管理者 | Worker、Bindings、Secrets、Queues、D1、ログ、デプロイ |
| Microsoft 365管理者 | Entraアプリ、Mail.Send、管理者同意、Exchange App RBAC、専用Mailbox |
| 運用担当 | 監視、DLQ確認、再処理、シークレット／証明書更新、監査 |

## 5. 前提・制約・TBD

| **ID** | **項目** | **内容／決定ゲート** |
|----|----|----|
| ASM-01 | EmDash互換性 | 実バージョン、Forms、email:deliver契約をPhase 0で実機検証。0.19未満または契約差異があれば設計を再承認 |
| ASM-02 | 送信Mailbox | TBD。専用Mailboxを1つ選定し、Exchange App RBACで当該Mailboxのみに限定 |
| ASM-03 | 管理者通知先 | TBD。EmDash管理者が許可リストから選択。フォーム入力では変更不可 |
| ASM-04 | 自動返信 | TBD。初期値は無効。メールアドレスは形式検証済みであり、所有者確認済みとは表現しない |
| ASM-05 | 資格情報 | 本番は証明書／Federationを優先評価。MVPでClient Secretを使う場合は期限・ローテーション・例外承認を必須化 |
| ASM-06 | データ所在地 | Cloudflare／Microsoft 365の契約・Jurisdictionと適用するデータ取扱基準を本番前に確認 |

## 6. 業務フロー

```text
訪問者 → EmDashフォーム → Turnstile検証 → 入力／許可フォーム検証
→ submissionId採番・重複確認 → Queue投入 → 受付応答
→ Queue Consumer → Entraトークン → Graph sendMail → Exchange Online
→ 配送メタデータ記録 ／ 一時失敗は再試行 ／ 最終失敗はDLQ
```

## 7. 機能要件

| **ID** | **機能** | **要件** | **優先度** |
|----|----|----|----|
| FR-001 | フォーム受付 | 許可済みformIdのみ受け付け、未許可は403相当で拒否する | Must |
| FR-002 | Bot対策 | サーバー側でTurnstile Siteverifyを実行し、失敗・期限切れ・再利用を拒否する | Must |
| FR-003 | 入力検証 | 氏名、メール、種別、本文を正規化・長さ制限し、CR/LFヘッダー注入を拒否する | Must |
| FR-004 | 管理者通知 | 固定From／許可リストTo／問い合わせ者Reply-Toで送信する | Must |
| FR-005 | 自動返信 | 有効時のみ、形式検証済み入力メール宛に固定テンプレートから送る | Should |
| FR-006 | テンプレート | フォーム別の承認済み件名・Text/HTMLテンプレートを使用し、入力値をエスケープする | Must |
| FR-007 | Queue | 本番は受付後にメッセージをQueueへ投入し、ConsumerがGraphへ送信する | Must |
| FR-008 | 再試行 | 429はRetry-After、5xx／ネットワーク例外は指数バックオフ、400/403は原則再試行しない | Must |
| FR-009 | DLQ | 最大試行超過をDLQへ移し、運用者が原因・再処理可否を判断できる | Must |
| FR-010 | 冪等性 | submissionId×messageTypeで重複送信を抑止し、同じ処理の再実行を安全にする | Must |
| FR-011 | Graph認証 | tenant固有token endpointへclient_credentialsで要求し、scopeはGraph /.defaultを使う | Must |
| FR-012 | 権限制限 | Mail.Sendを専用MailboxのみにExchange App RBACで制限し、範囲内／外テストを実施する | Must |
| FR-013 | 設定管理 | 秘密値はSecrets、非秘密値は環境別vars／管理者設定へ分離する | Must |
| FR-014 | テスト送信 | 管理者のみが許可済みテスト宛先へ実行でき、通常フォーム経路と区別して記録する | Should |
| FR-015 | 応答 | 受付成功、検証失敗、混雑、内部障害を利用者向けに情報漏えいなく返す | Must |

## 8. 非機能要件

| **ID** | **分類** | **要件** |
|----|----|----|
| NFR-SEC-01 | 機密性 | Tenant/Client情報、秘密鍵、Turnstile secretをGit・通常vars・ログに出力しない |
| NFR-SEC-02 | 最小権限 | Graph Mail.Send＋Exchange App RBAC。範囲外Mailboxの送信テストが失敗すること |
| NFR-SEC-03 | 資格情報 | Secret方式は有効期限90日を目安に自動アラート、少なくとも12か月未満。証明書／Federation移行を評価 |
| NFR-REL-01 | 信頼性 | Queue受領を受付境界とし、5回を上限に再試行。DLQを設定 |
| NFR-PERF-01 | 性能 | フォーム受付p95 2秒以内（Queue投入まで、外部Siteverify遅延を除く異常時は5秒で打切り） |
| NFR-LIM-01 | 濫用防止 | Rate Limiting Bindingは60秒粗粒度。10分／30分等の厳密窓が必要ならDurable ObjectsまたはD1を使用 |
| NFR-OBS-01 | 可観測性 | correlationId、submissionId、messageType、試行回数、Graph status/request-id、処理時間を構造化ログ化 |
| NFR-PRI-01 | 個人情報 | 本文、電話、完全なメールアドレス、access tokenをログに残さない。宛先はマスク |
| NFR-OPS-01 | 運用 | 環境分離、段階デプロイ、ロールバック、DLQ runbook、資格情報更新runbookを用意 |
| NFR-COMP-01 | 互換性 | EmDashバージョン／capability contractをCIまたはstagingで確認してから本番反映 |

## 9. 入力・メールポリシー

| **項目** | **制約（初期値）** | **備考** |
|----|----|----|
| 氏名 | 1〜100文字 | 制御文字除去 |
| メール | 254文字以内、単一アドレス | 形式検証のみ。所有者確認ではない |
| 問い合わせ種別 | 許可済み列挙値 | 件名へ直接連結せずマッピング |
| 本文 | 1〜5,000文字 | HTMLエスケープ／Text版も生成 |
| 件名 | テンプレート生成、200文字以内 | CR/LF禁止 |
| 添付 | 不可 | 将来要件として別審査 |
| From | 固定Mailbox | フォーム入力不可 |
| 管理者To | 許可リスト | フォーム入力不可 |
| CC/BCC | なし | 初期リリース |

## 10. 受入条件

| **ID** | **受入条件**                                                   |
|--------|----------------------------------------------------------------|
| AC-01  | 許可フォームの正常送信でQueue投入と受付応答が成功する          |
| AC-02  | Turnstile失敗／期限切れはメールを生成せず拒否する              |
| AC-03  | 任意のFrom/To/CC/BCC/件名/HTML注入ができない                   |
| AC-04  | 管理者通知のReply-Toが入力メールに設定される（CR/LF除外）      |
| AC-05  | Graph 202を「要求受付」と記録し、最終配送完了と表示しない      |
| AC-06  | 429/5xxは方針どおり再試行し、400/403はDLQまたは要対応へ送る    |
| AC-07  | 同一submissionId×messageTypeを再処理しても二重送信しない       |
| AC-08  | 範囲内Mailboxは送信可、範囲外MailboxはApp RBACで送信不可       |
| AC-09  | Git、ビルド成果物、ログに秘密情報と本文全文が存在しない        |
| AC-10  | DLQから原因確認・承認済み再処理・破棄がRunbookどおり実行できる |
| AC-11  | EmDash実バージョンでemail:deliver契約テストが通る              |
| AC-12  | 資格情報期限、DLQ滞留、送信エラー率のアラートがテストできる    |

## 11. リリース計画

| **Phase** | **内容** | **完了ゲート** |
|----|----|----|
| 0 互換性・リスク確認 | EmDash contract、Mailbox、通知先、認証方式、データ所在地 | TBD全件のオーナー・期限・決定 |
| 1 Staging最小経路 | Secrets、token、Graph sendMail、固定From/To | App RBAC範囲内成功／範囲外失敗 |
| 2 フォーム連携 | Turnstile、検証、テンプレート、自動返信 | セキュリティ／濫用テスト合格 |
| 3 本番信頼性 | Queues、D1冪等性、再試行、DLQ、監視 | 障害注入・再送・Runbook演習合格 |
| 4 拡張 | フォーム別設定、多言語、バウンス監視、添付検討 | 個別審査 |

## 12. 未決事項

| **ID** | **決定事項** | **責任者** | **期限／ゲート** |
|----|----|----|----|
| TBD-01 | EmDash／Formsの実バージョンとemail:deliverの型契約 | Principal Engineer | Phase 0 |
| TBD-02 | 専用Mailboxと表示名 | M365管理者 | Phase 0 |
| TBD-03 | 管理者通知先・自動返信初期値 | Product Manager | Phase 0 |
| TBD-04 | 本番資格情報：証明書／Federation／期限付きSecret | CTO/CISO | Phase 0 |
| TBD-05 | Cloudflareデータ所在地・保持 | CTO/法務 | 本番前 |
| TBD-06 | SLO／通知閾値 | 運用責任者 | Phase 3 |

## 参照資料

| **資料** | **URL** | **本書での利用** |
|----|----|----|
| Microsoft Graph user: sendMail | <https://learn.microsoft.com/graph/api/user-sendmail?view=graph-rest-1.0> | Mail.Send、/users/{id}/sendMail、202 Accepted の意味 |
| Microsoft Graph send mail process | <https://learn.microsoft.com/graph/outlook-things-to-know-about-send-mail> | 送信処理の非同期性と後続配送 |
| Exchange Online RBAC for Applications | <https://learn.microsoft.com/exchange/permissions-exo/application-rbac> | アプリ権限のメールボックス単位スコープ |
| Microsoft identity platform client credentials | <https://learn.microsoft.com/entra/identity-platform/v2-oauth2-client-creds-grant-flow> | client_credentials と .default スコープ |
| Cloudflare Workers Secrets | <https://developers.cloudflare.com/workers/configuration/secrets/> | 暗号化されたシークレットBinding、ローカル開発 |
| Cloudflare Workers Rate Limiting | <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/> | 近似カウンタ、10/60秒窓、ロケーション単位 |
| Cloudflare Turnstile server-side validation | <https://developers.cloudflare.com/turnstile/get-started/server-side-validation/> | Siteverify必須、5分・単回利用トークン |
| Cloudflare Queues configuration / DLQ | <https://developers.cloudflare.com/queues/configuration/configure-queues/> | 再試行、max_retries、Dead Letter Queue |
| EmDash Cloudflare email reference implementation | <https://github.com/tmyuu/emdash-cloudflare-email> | EmDash 0.19+ / 1.x の email:deliver 実装パターン |

参照日: 2026年11月16日。製品仕様は更新されるため、実装着手時に再確認する。

---

この文書は [Apache License 2.0](../LICENSE) の下で提供されます。製品名・商標は各権利者に帰属します。
