# 認証IDが変わった既存利用者のログイン（issue #1113）

## 何が起きていたか

`/auth/callback` は StatusHub の許可判定のあと、`User` を `supabaseUserId`（Supabaseの認証ID）をキーに upsert していた。
`User.email` にも一意制約があるため、Supabase側の認証IDが変わった利用者（同じメールの `User` 行が旧認証IDのまま残っている）では
新しい行を作れず、`P2002 / User_email_key` で毎回500になっていた。さらにSupabaseのセッションだけが残るため、
保護ページ（`getCurrentUser()` が null）→ `/login` → ミドルウェアが「ログイン済み」と見て元の画面へ戻す、の往復になりうる。

認証IDが変わった経緯（Supabase側のユーザーの削除・再作成など）はログからは確定していない。Supabaseにユーザーが
いることと、YoteiFlowのDBの紐付けが正しいことは別の問題として扱う。

## 方針

`User.id` は設定・Google/Notion連携・保存済みデータすべての所有者。行を削除・作り直さず、既存の行の `supabaseUserId` だけを付け替える。
判定は `src/lib/auth/link-user.ts`（`linkUser()`）、DBへの書き込みは `src/lib/auth/user-link-store.ts`。

1. 認証IDに対応する `User` があれば従来どおり（Googleへの往復は増えない）。ただし同じメールを別の `User` が持つときは、どちらも書き換えず `account_conflict`。
2. 同じメールの `User` も無ければ新規作成。
3. 認証IDの `User` が無く、同じメールの `User` があるときだけ、次をすべて満たせば付け替える。満たさなければ何も書き換えず `account_conflict`。

| 条件 | 理由 |
|---|---|
| 今回のOAuthで受け取ったGoogleのアクセストークン（`session.provider_token`）を Google の userinfo へ照会でき、`email_verified` が真 | `user_metadata` は利用者が `updateUser()` で書き換えられる。ブラウザの申告・メタデータではなく、トークンの持ち主をGoogle自身に確かめる |
| userinfo の `sub` が、Supabaseがこの認証IDに結び付けたGoogleのID（`user.identities` の provider=google。プロバイダが返した値で利用者は書き換えられない）に含まれる | 別のGoogleアカウントのトークンで他人の認証IDを通さない |
| userinfo のメール・Supabaseのメール・既存 `User` のメールが一致（大文字小文字は区別しない） | 照合の起点はメールだけなので、3者が同じものを指していることを確かめる |
| メールが `gmail.com` / `googlemail.com`、または Workspace の `hd` がそのメールのドメインと一致 | Googleがそのメールの持ち主を決められる場合に限る。それ以外のドメインを使う個人のGoogleアカウントは、作成時に確認されただけで現在の持ち主とは限らない |
| 既存 `User` のCalendar連携（`GoogleAccount`）に、同じメールで別の `googleUserId` が無い | 以前そのメールを別のGoogleアカウントが使っていた形跡があれば別人の可能性がある。逆に連携のどれかが一致することは本人の根拠にしない（連携は複数持て、家族など別人のアカウントも入りうる） |

旧認証IDのSupabaseユーザーがまだ残っているかは確かめていない（YoteiFlowはSupabaseの管理者キーを持たない）。
Supabaseは確認済みの同じメールを1人のユーザーへまとめるため、同じGoogleアカウントで別の認証IDが作られているなら、
旧ユーザーは削除されたかメールが変わったと考えられる。付け替えた場合は `user=<User.id>` だけをログへ出す。

## 同時ログイン・再試行

書き込みは1行1文で、付け替えは「旧認証IDのままなら」の条件付き更新（`updateMany`）。一意制約違反（P2002）・
条件付き更新の空振りは最初から読み直して再試行し（3回まで）、2回目以降は認証IDで既存の `User` が見つかる。
重複した `User`・途中まで書き換えた紐付けは残らない。回帰テストは `link-user.test.mts`。

## 失敗したとき

- コールバックは失敗の段階（`stage=code_exchange|access_decision|user_link|google_identity|session_handoff`）と理由の種類だけをログへ出す。トークン・認可コード・メール・Prismaの例外本文は出さない。
- このアプリのこの端末のセッションだけを破棄し（`signOutThisApp()`・scope local。共有Supabaseユーザーの削除・他アプリのセッション失効はしない）、`/login?error=callback_failed`（再試行で直りうる）か `account_conflict`（自動では結び付けない）へ戻す。iOSは `yoteiflow://auth-callback?error=` で同じ値を受け、WebViewの `/login?error=` へ渡す（値の一覧は `NATIVE_LOGIN_ERRORS` と Swift の `loginErrors` で、`check-consistency.mjs` が照合）。
- 保護ページは `getCurrentUser()` が null のとき `/login?error=session_unlinked` へ戻す。ミドルウェアは `error` が既知の値（`src/lib/login-errors.ts`）なら、ログイン済みでも起動画面へ戻さない。これで往復せず、案内と「Googleでログイン」が表示される。

## `account_conflict` になった利用者の復旧

自動統合はしない。削除・作り直し・連携解除による初期化もしない。本番DBを手で直す場合は、次を別途確かめたうえで行う。

1. 対象：`User` の行（`id`・旧 `supabaseUserId`・`email`）と、ログに出た `detail`（理由の種類）。
2. 根拠：Supabaseの管理画面で、新しい認証IDのユーザーのGoogle identity（`sub`・メール）と、旧認証IDのユーザーの有無・identity を確かめる。同じ人物と確定できたときだけ進める。
3. 変更：`UPDATE User SET supabaseUserId = '<新しい認証ID>' WHERE id = '<User.id>' AND supabaseUserId = '<旧認証ID>'`（1行だけが変わることを確かめる）。
4. 復元：同じ文を新旧入れ替えて実行すれば元へ戻る。

## 本番反映後の確認

PRのマージでは完了扱いにしない。反映後、利用者に新しくGoogleでログインしてもらい（使用済みのコールバックURLは再利用しない）、
以前の設定・Google Calendar・Notionの連携がそのまま使えること、PM2のログに `認証IDが変わった既存ユーザーを付け替え` が1回だけ出て
`P2002` が出なくなったことを確かめる。
