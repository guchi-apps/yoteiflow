# YoteiFlow iOSアプリ

本番YoteiFlow（`https://dayspan.gucchii.com/`）をiPhone・iPadのアプリとして開くための、SwiftUI + WKWebView の薄い殻です（#908・#1060）。
**画面と機能はすべてWeb版が正本**で、ここには「Web版を開く・Googleログインと Calendar 連携を認証シートで往復させる・通信できないときに再試行させる」ことしか書いていません。既存のWeb/PWA版はそのまま残り、挙動は変えていません。

| 項目 | 値 |
|---|---|
| 表示名 | YoteiFlow |
| Bundle ID | `com.gucchii.yoteiflow` |
| 署名 | Automatic（Apple Developer Program のチーム `6AA3WFTR94`。kurashioと同じチーム） |
| 対応 | iPhoneは縦向き、iPadは縦・横向きとウィンドウサイズ変更に対応。iOS / iPadOS 18以上 |
| 認証シートの戻り先 | `yoteiflow://auth-callback`（ログイン）・`yoteiflow://google-connected`（Calendar連携） |
| App Group | `group.com.gucchii.yoteiflow`（アプリとウィジェットでトークンを共有する Keychain のアクセスグループ。#926） |
| ウィジェット拡張 | `YoteiFlowWidget`（Bundle ID `com.gucchii.yoteiflow.widget`） |
| 共有拡張 | `YoteiFlowShare`（Bundle ID `com.gucchii.yoteiflow.share`）。Yahoo!乗換案内の共有 ▸ YoteiFlow で、経路を確認してから移動を登録する（#1026・#1054）。停止専用トークンのBearerで `/api/shortcuts/travel/preview` を呼び、登録を押したときだけ `/import` を呼ぶ。**共有シートが渡す項目（テキストかURLか）は実機未確認。Xcodeが無い環境で作ったためpbxproj・Swiftは未ビルド** |
| Associated Domains / Push | 使わない（初回スコープ外） |

## 更新が要る場所

| 変えたもの | Web/PWA | iOSアプリ |
|---|---|---|
| 画面・機能（`src/`） | mainへマージ → 自動デプロイ | 何もしなくてよい（次に開いたとき本番の新しい画面が出る） |
| アプリの殻（`ios/`） | 影響なし | Xcodeで入れ直す／TestFlightへ新しいビルドを上げる |

## ビルド方法（Mac + Xcode）

**subpc には Xcode が無い**ため、ビルド・実機確認はMacで行います。

1. Xcode 27系を使う（`project.pbxproj` は Xcode 27 で保存すると `objectVersion = 110`。それより古いXcodeは「新しすぎるプロジェクト形式」で開けない。kurashio #606 と同じ）
2. `open ios/YoteiFlow.xcodeproj`
3. スキーム `YoteiFlow`・実行先を自分のiPhoneまたはiPadにし、Signing & Capabilities の Team が Apple Developer Program のチームになっていることを確かめて ⌘R
4. 実機への初回インストールでは、端末の 設定 → プライバシーとセキュリティ → デベロッパモード をオンにし、設定 → 一般 → VPNとデバイス管理 で開発者証明書を信頼する

### iPad の表示確認（#1060）

`TARGETED_DEVICE_FAMILY` はアプリ本体・Widget拡張・共有拡張の Debug／Release で `1,2` に揃える。アプリ本体は iPhone の縦向き指定を保ち、iPad では4方向を許可する。Web の `AppFrame` は実際に渡された表示幅でサイドバーと本文を切り替えるため、アプリ本体が iPhone 専用のままだと、Web 側のレスポンシブ表示を直しても iPad では縦長の互換表示から抜けられない。`node ios/scripts/check-consistency.mjs` でこれらの設定を検査する。

1. Xcode の iPad シミュレーターまたは実機へ **新しいビルド**を入れ、`/calendar` を開く。Safari・PWAではなく YoteiFlow アプリで確認する。
2. 縦向きでは左に192pxのサイドバー、右にカレンダーが表示され、期間と操作が2段に分かれることを確認する。
3. 横向きでは左に224pxのサイドバー、右に全幅のカレンダーが表示され、期間と操作が1段になることを確認する。
4. Split View またはウィンドウサイズ変更で幅を狭め、768px未満では下部ナビ、768px以上ではサイドバーに切り替わり、画面の左右が余らないことを確認する。タスク・記録・勤務・買い物も開き、本文の列が幅に応じて変わることを確認する。
5. iPhone では従来どおり縦向き・下部ナビで表示されることを確認する。

署名・App Store Connect APIキー・シェルの注意（終了コードをパイプで隠さない等）は kurashio の `ios/README.md`（`guchi-apps/myroom`）と `guchi-apps/docs#176` を参照してください。Widget拡張と App Group（#926）を持つため、初回は Xcode の Signing & Capabilities で両ターゲット（YoteiFlow・YoteiFlowWidget）の Team が正しいことを確かめてください（App Group と拡張の App ID は自動署名＋`-allowProvisioningUpdates` で登録されます）。

## TestFlight で配布する（#920）

Mac につながなくても、iPhone の TestFlight アプリからインストール・更新できるようにする手順です。**ビルドとアップロードは Mac でしかできません**（subpc に Xcode が無い）。開発用署名の入れ直し（約1年／無料チームなら7日）も TestFlight 版には要りません（TestFlight のビルドは90日で期限切れになるため、そのたびに新しいビルドを上げます）。

| 項目 | 値・運用 |
|---|---|
| App Store Connect のアプリ | 名前 `YoteiFlow`・Bundle ID `com.gucchii.yoteiflow`・チーム `6AA3WFTR94`（初回だけ手作業） |
| 輸出コンプライアンス | `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO`（pbxproj。標準のHTTPS通信のみで独自暗号化は無いため）。毎回の質問は出ない |
| アイコン | `AppIcon.appiconset` の1024px（アルファ無し）。App Store 用はこれ1枚でよい |
| 版番号（`MARKETING_VERSION`） | `package.json` の `version` と揃える。リリースの版上げ（`npm version`）が `version` lifecycle から `sync-version.mjs` を実行し、バンプコミットへ含める（#946）。手で確かめるなら `node ios/scripts/sync-version.mjs`（冪等） |
| ビルド番号（`CURRENT_PROJECT_VERSION`） | アップロードのたびに増える必要がある。スクリプトが Archive 時に日時（`YYYYMMDDHHMM`）で上書きするので、pbxproj は触らずコミットも要らない（`IOS_BUILD_NUMBER` で固定も可） |

### 初回だけ（手作業）

1. [App Store Connect](https://appstoreconnect.apple.com/) → マイApp → 「+」→ 新規App。プラットフォーム iOS・名前 YoteiFlow・プライマリ言語 日本語・Bundle ID `com.gucchii.yoteiflow`・SKU は任意（例 `yoteiflow`）
2. App Store Connect API キーは**新しく作らず、kurashio と共用**する（APIキーはチーム単位のため YoteiFlow にもそのまま使える）。1Password の項目 `apps/AppStoreConnect` の `key-id`・`issuer-id`・`key-p8`（`.p8` の中身をbase64の1行にした値）を `ios/asc.env.tpl` が参照している。**キーの発行・登録は不要**
3. スクリプトは `asc-key-p8` を復号して Mac 上の一時ファイル（権限600）へ書き出し、`xcodebuild` に渡して、終了時（失敗時も）に消す。鍵の中身・パスはログに出さない
4. TestFlight →「内部テスト」にグループを作り、自分（App Store Connect のユーザー）を追加。ビルドの暗号化の質問が出た場合は「いいえ（標準の暗号化のみ）」

### ビルドを上げるたび（subpc から1コマンド・#929）

kurashio の `remote-install.sh` と同じ形で、subpc から Tailscale 越しに Mac（既定 `guchimac-mini`）へSSHして、取り込み → 整合チェック → Archive → アップロードまで行います。**Web側が main へデプロイされた後に**、`main` から上げます。

```bash
node ios/scripts/sync-version.mjs          # 版番号の確認（通常はリリースで同期済みで差分は出ない）
ios/scripts/remote-upload-testflight.sh    # Mac で main を取り込み、TestFlight へ上げる（手動。自動配信は下の「自動配信」）
```

- Mac 側の前提: チェックアウトが `$HOME/apps/yoteiflow` にある（別の場所なら `MAC_REPO_DIR='$HOME/x'`。チルダ付きで渡さない）・Xcode・1Password CLI（`op`）にサインイン済み・ログインキーチェーンが開いている（codesign が失敗したら Mac で `security unlock-keychain ~/Library/Keychains/login.keychain-db` を一度）
- `MAC_HOST`・`MAC_REPO_DIR`・`IOS_BRANCH`（既定 main）・`IOS_SKIP_PULL=1`・`IOS_BUILD_NUMBER` を環境変数で上書きできる。作業ツリーに未コミットの変更があると中止する。SSH経由のスクリプトは、1Passwordが `asc.env.tpl` を読む前にMac側の対象ブランチを取り込むため、古いチェックアウトでも現在の参照先を使える。`IOS_SKIP_PULL=1` を指定した場合は取り込みを省略し、Macにあるテンプレートをそのまま使う
- Mac の前にいるなら、Mac のチェックアウトで直接 `op run --env-file=ios/asc.env.tpl -- ios/scripts/upload-testflight.sh`
- **subpc からは実行結果を確かめられない**（Xcode が無い）。初回は Mac で1回通して確かめる

スクリプトは `check-consistency.mjs`（本番URLのまま・Bundle ID等）→ `xcodebuild archive` → `xcodebuild -exportArchive`（`ExportOptions.plist` の `destination: upload` で App Store Connect へ直接アップロード）を順に実行します。**終了コードをパイプで隠さないこと**（`| tee` 等を付けない）。App Store Connect 側の処理（数分〜）が終わると TestFlight に出ます。内部テスターへは審査なしで配布されます。

### TestFlight 版の確認

- [ ] iPhone の TestFlight アプリに YoteiFlow が出て、インストールできる
- [ ] 起動してログイン（上の「実機確認手順」と同じ）でき、再起動してもログインしたまま
- [ ] 新しいビルドを上げると TestFlight から更新できる
- [ ] iPad の TestFlight アプリから入れ、上の「iPad の表示確認」の縦向き・横向き・ウィンドウサイズ変更を確かめる

> 開発用に Xcode から入れたアプリと TestFlight 版は Bundle ID が同じため上書きされます。入れ替える前にどちらか一方を削除すると確実です。

### 自動配信（GitHub Actions・#961）

`main` へのデプロイ（`Deploy to Production`）が成功すると、`ios-testflight-trigger.yml` が `ios-testflight.yml`（`iOS TestFlight`）を起動します。kurashio（#591）と同じ構成で、issue-deck のブランチ画面の「iOS配布（TestFlight）の結果」がこのワークフローの段階（判定・署名・ビルド・アップロード・処理待ち・内部グループ配布）を読んで表示します。

- 判定は `ios/scripts/ios-changes.mjs`。配布物（`YoteiFlow/`・`YoteiFlowWidget/`・`YoteiFlowShare/`・`Shared/`・`Config/`・`AppInfo.plist`・`YoteiFlow.xcodeproj/`。README・scripts・版番号の行だけの差分は除く）に、最後の配布印（タグ `ios-testflight/<ビルド番号>`）以降の変更があるときだけ配布する。印は配布し終えたときだけ進むので、失敗した配布の変更は次の判定にも残る
- ビルド番号は `run_number*100+run_attempt`。**手動の `upload-testflight.sh`（日時 `YYYYMMDDHHMM`）より小さくなる**ため、同じ版番号で手動のあとに自動配信すると App Store Connect が「ビルド番号が小さい」として拒否する。自動配信へ移したあとは手動アップロードを使わないか、`IOS_BUILD_NUMBER` で自動側より大きい値を指定する
- 手動実行: `gh workflow run ios-testflight.yml -f sha=<main上のコミット> [-f dry_run=true]`。`dry_run` は判定だけ行いビルドしない
- 署名は App Store Connect APIキー（クラウド署名）。キーは GitHub Secrets の `ASC_KEY_ID`・`ASC_ISSUER_ID`・`ASC_KEY_P8`（正は 1Password の `op://apps/AppStoreConnect/*`。手動用の `asc.env.tpl` も同じ参照先）。内部グループが複数あるときだけ GitHub の variable `TESTFLIGHT_GROUP` にグループ名を置く
- ビルドは GitHub ホストの `xcode-27` ランナー。**subpc には Xcode が無く、ワークフローの実行・署名・App Store Connect との疎通は未確認**。初回は `dry_run` → 本番の順に確かめてください
- **Swiftのコンパイルエラーに気付けるのはこのワークフローだけ**（PRのCIはSwiftをビルドしない・`dry_run` もビルドしない・main 以外のコミットは配布できない）。アプリ本体はWidget拡張を埋め込むため、**Widget が先にビルドされ、そこで落ちると本体はコンパイルすら始まらない**。ログにWidgetのエラーしか出ていなくても、本体側に別のエラーが隠れていることがある（#989 で、Widget を直したあとに本体の未コンパイルの変更〔#968・#971・#976〕も目視で直した）。Xcodeの無い環境でSwiftを書くときは、特に次の2つを見落としやすい
  - `@MainActor` の型（`LiveActivityCoordinator` など）を、アクター指定の無い型（`WebViewModel`）の同期の関数から呼ばない（Swift 5 モードでもエラー）。`Task { @MainActor in … }` で渡すか、async 関数なら `await` を付ける
  - ジェネリックな `View` を返すクロージャを受ける引数には `@ViewBuilder` を付ける（付けないと `let x = …` を挟んだ複数文のクロージャが `()` と推論される）

### 署名と証明書（#975）

- 自動署名（`-allowProvisioningUpdates`）は、実行のたびに Development 証明書を「Created via API」として Apple 側へ新規に作る。使い捨てのランナーに秘密鍵は残らないため、掃除しないとアカウントの証明書数の上限に達する（#966で実際に失敗した）。
- 対応として `asc-api.mjs revoke-api-dev-certs` が、**表示名（APIの `displayName`）が「Created via API」の Development 証明書だけ**を失効させる（APIの `name` は「Apple Development: Created via API」と種別の接頭辞が付くため、`name` の完全一致では1件も選ばれず、#1010で再び上限に達した）。署名の前（前回の失敗の残り）と後（`always()`）に実行する。Mac の Xcode が作った自分用の証明書・Distribution 証明書は対象外。配布（エクスポート）は Apple のクラウド管理の Distribution 証明書で署名されるため、失効させても影響しない。
- 手動確認: `ASC_*` を環境に置き `node ios/scripts/asc-api.mjs revoke-api-dev-certs --dry-run true` で対象だけ一覧できる。
- 同じ `apps/AppStoreConnect` のキーで同じ証明書枠を使う kurashio にも同じ掃除が要る（別Issue）。同時に両方のビルドが走ると、片方の掃除が他方の署名中の証明書を失効させる可能性がある（まれ。失敗したら再実行）。
- 採らなかった方式: 手動署名（Distribution 証明書・プロファイルを 1Password から取り込む）。証明書は増えないが、.p12・プロファイルの発行と更新（1年）の運用が要る。この掃除で再発しなくなるため見送り、再発したら再検討する。

### App ID・App Group の事前登録（手動）

APIキーの自動署名は App ID・App Group を**作れない**（既存のものへ紐付けるだけ）ため、初回の前に Apple Developer の Identifiers で手動登録する。

1. App ID `com.gucchii.yoteiflow`（アプリ本体）・`com.gucchii.yoteiflow.widget`（Widget）・`com.gucchii.yoteiflow.share`（共有拡張・#1026）を作る。**拡張を足したときは、その App ID もここで足す**。未登録だと `No profiles for '…share' were found` と `Authentication failed: Make sure a bearer token…` でアーカイブが落ちる（#1041）
2. App Group `group.com.gucchii.yoteiflow` を作り、3つすべての App ID の App Groups capability に紐付ける
3. アプリ本体の App ID には Push Notifications も有効にする（APNs・#925）

## 開発環境と本番の切り替え

`Shared/SharedConfig.swift` の `baseURL` だけを変えます（アプリとウィジェット拡張が同じ値を読みます）。**LAN IP の `http://` のままではSupabase Authのリダイレクトが戻れない**ため、sslip.io などでホスト名にし、そのURLをSupabaseの許可リダイレクトURLに入れます（`sslip-io-lan-dev` の手順）。**戻すのを忘れてコミットしないこと**（`node ios/scripts/check-consistency.mjs` と `pnpm test:unit` が本番URLかを確かめます）。

## Google / Supabase 側の設定

**新しく登録する URL は不要です。** アプリが認証シートで開くのはWeb版の `/auth/native/start`・`/api/google/connect` で、Supabase・Google に返るのは既存の `https://dayspan.gucchii.com/auth/callback`・`/api/google/callback` だけです。`yoteiflow://` へ戻すのはサーバー（DaySpanの `/auth/callback`・`/api/google/callback`）で、Supabase/Googleの許可リストには登録しません。

ただしログインの戻り先は `/auth/callback?native=1&challenge=…&next=…` とクエリが増えます。Supabaseの Redirect URLs が `https://dayspan.gucchii.com/auth/callback` の完全一致だけだとクエリ付きで弾かれる可能性があるため、**実機で最初のログインが通るかを確かめてください**（既存の `?next=` 付きと同じ扱いのはずですが、subpc では確認できません）。通らなければ `https://dayspan.gucchii.com/auth/callback**` のようにワイルドカードを足します。

## 仕組み

### Googleログイン（認証シート → 引き継ぎコード → WebView）

`ASWebAuthenticationSession` と `WKWebView` は Cookie を共有しません。YoteiFlow のログインは `@supabase/ssr` の Cookie セッションなので、次の方式でWebViewへ引き継ぎます。**認証シートは毎回エフェメラル**（Safariの既存ログインに触れない代わりに、毎回Googleの入力が要る）。

1. Web の `/login` の「Googleでログイン」（素の `<a href="/auth/signin?next=…">`）を、アプリが `decidePolicyFor` で捕まえてWebView内では開かない
2. アプリが PKCE の `verifier`（乱数）と `challenge`（S256）を作り、認証シートで `/auth/native/start?challenge=…&next=…` を開く
3. Google → Supabase → サーバーの `/auth/callback?native=1&…`。**許可の確認（StatusHubの共通アクセス設定）とユーザー作成は Web版と同じ箇所**で行い、許可外は `yoteiflow://auth-callback?error=not_allowed`
4. サーバーはセッションのトークンを暗号化して60秒だけDBへ置き、**トークンではなく一度限りのコード**だけを `yoteiflow://auth-callback?code=…` で返す
5. アプリはWebViewの中から `POST /auth/native/consume`（本文に `code` と `verifier`）を呼び、通常の Supabase SSR Cookie を受け取ってから `next`（起動画面の設定込み）を開く

使用済み・期限切れ・別用途・verifier不一致のコードはすべて同じ拒否になります。アクセストークン・リフレッシュトークンは、URL・アプリのログ・Swiftのコードのどこにも出ません。コードは `verifier` が無ければ消費できないので、他のアプリが `yoteiflow://` を横取りしてもログインできません。

### Google Calendar連携

1. Web の「接続」リンク（`/api/google/connect`）を捕まえ、ログイン済みのWebViewから `POST /api/google/connect/intent` で一度限りのintent（60秒）を発行
2. 認証シートで `/api/google/connect?intent=…` を開く。**この時点でintentは使い捨て**（クエリはアクセスログに残るため）。サーバーが state を発行し、同意画面へ
3. `/api/google/callback` が state で intent を引き、Cookie の state と一致し未完了のときだけ、**intent のユーザー**へ資格情報を保存（スコープ・offline access・暗号化は Web版と同じ）
4. `yoteiflow://google-connected?result=connected` でアプリへ戻り、設定画面を開き直す

### 外部リンク・通信失敗・ダイアログ

- YoteiFlowと同一オリジン（スキーム・ホスト・ポート）だけをWebView内で開き、他はSafariで開く（`AppConfig.isAppURL`）
- 通信できない・5xx のときは `ConnectionErrorView` が理由と「再読み込み」を出す。回線が戻れば自動で読み直す
- `alert` / `confirm` は `WKUIDelegate` で実装（無いと削除の確認が常に「キャンセル」になる）
- 上端はヘッダーと同じ色（`HeaderBand`）で塗り、WebViewはステータスバーの下から始める
- ログイン状態は WKWebView の既定データストアに残り、再起動しても維持される

### オフライン表示（Service Worker）

`ios/AppInfo.plist` で `WKAppBoundDomains`（`dayspan.gucchii.com`）を宣言し、WebViewで `limitsNavigationsToAppBoundDomains = true` にしています（#927）。これでWKWebViewでもService Workerが動き、PWAと同じ「保存済みの画面をオフラインで開く」「低速回線（3秒）で保存済みへ切り替える」（`public/sw.js`・docs/spec.md §21）がアプリ内で効きます。`ConnectionErrorView` が出るのは、Service Workerが保存済みを返せない場合（初回起動・未保存の画面・Service Worker登録前）だけです。

App-Bound Domains の制約と扱い:

- 宣言外のドメインへの遷移・JavaScript注入はWebView内で制限される。外部リンクは元からSafariで開いており（`AppConfig.isAppURL`）、Google認証・Calendar連携は認証シート（`ASWebAuthenticationSession`）なので影響しない。`callAsyncJavaScript`（引き継ぎコードの消費・intent発行）は宣言したドメインのページ上でだけ実行される
- **宣言は `baseURL` のホストと一致させる**（`check-consistency.mjs` が本番側を照合する）。開発用に `baseURL` を sslip.io 等へ向けるときは、`AppInfo.plist` にも同じホストを足すこと（足さないとWebViewが読み込めない／Service Workerが動かない）。コミット前に本番の値へ戻す
- 宣言できるのは最大10件。いまは1件。将来ほかのドメインをWebView内で開く必要が出たら、その都度ここへ足す（足せない外部サービスは認証シートかSafariで開く）
- Info.plist の配列はビルド設定（`INFOPLIST_KEY_*`）で書けないため、生成されるInfo.plistへ `AppInfo.plist` を統合している

### ウィジェット（WidgetKit・#926）

Scriptableなしで、ホーム画面・ロック画面に活動記録・今日の予定・タスク・買い物リストを出します。Scriptable版（設定画面・台本）は issue #1000 で撤去しました。

| 項目 | 内容 |
|---|---|
| 面 | 活動記録（`YoteiFlowActivity`）・今日の予定・タスク・買い物リストの4種類に加え、今日の予定とタスクを1枠に並べる「今日の予定とタスク」（`YoteiFlowToday`・#970。`/api/widget/schedule` と `/tasks` を並行して読み、片方が失敗・未設定でももう片方は出す。small=次の予定1件＋期限件数、medium=2列、large=縦2段）。ウィジェットギャラリーから選ぶ（Scriptableの `Parameter` のような切り替えは不要） |
| 枠 | systemSmall / Medium / Large、accessoryRectangular / Circular / Inline。文言はScriptable版に揃える。行数はネイティブ版が枠の高さに入るだけ並べる（Scriptable版は固定行数・#969） |
| 取得 | 既存の `/api/widget/*` を `Authorization: Bearer`（ウィジェット用トークン）で読む。**新しい取得APIは無い**。サーバー側の3分キャッシュはそのまま効く。15分ごとに更新を要求（iOSは目安として扱う） |
| 経過時間 | `Text(timerInterval:)`。端末が数えるので、更新を待たずに進み続ける |
| タップ | `yoteiflow://open?path=/tasks` などでアプリの該当画面（`/activity`・`/calendar`・`/tasks`・`/shopping`）を開く。許可した4パスだけ受ける |

**トークンの受け渡し**: ウィジェット拡張はWebViewのCookieを持てず、アプリが動いていない間も更新される。そのため、ログイン済みのWebViewが `POST /api/settings/widget/native`（Supabaseセッションで認証。発行済みのトークンを返し、無ければ発行する。**作り直さない**ので設定画面で配ったScriptable用のトークンは失効しない）を呼び、アプリが App Group の Keychain（アクセスグループ＝App Group ID・初回アンロック後は読める・端末間同期なし）へ保存する。ウィジェットはそこから読む。`/login` が開いたとき（ログアウト・未ログイン）は共有トークンを消す。ウィジェットのトークンは読み取り専用で、4面しか読めない。

**更新の合図**: 記録の開始・停止はWebの中で行われアプリへ伝わらないため、アプリが前面になったとき・トークンを保存したときに `WidgetCenter.reloadAllTimelines()` を呼ぶ。

**Live Activity（#971）**: 記録中の項目・経過時間・停止ボタンをロック画面・Dynamic Islandに出す。記録の開始・停止はWebの中や他端末でも起きるため、サーバーがAPNs（liveactivity）で追従させる（push-to-start で始め、activity push token へ update / end）。停止ボタンは `ios/Shared/` の `StopRecordingIntent`（LiveActivityIntent）が、Keychainの停止専用トークンで `/api/shortcuts/activity/stop` を呼ぶ。詳細は `docs/spec.md` §43。

実機確認の手順（Xcode・iOS 17.2以降の実機。ライブアクティビティはシミュレータの push に制限がある）:
1. Xcodeでビルドして実機へ入れ、ログインして1度アプリを開く（停止専用トークンとpush-to-startトークンが登録される）
2. 設定 ▸ iPhoneで「ライブアクティビティ」が許可されていることを確かめる
3. アプリを閉じた状態で、Web（PCのブラウザ）から記録を始める → ロック画面に項目名と経過時間が出る
4. ロック画面の「停止」を押す → 記録が止まり、表示が消える（Webでも止まっている）
5. 記録中にWeb側で別の項目へ切り替える → 表示が項目名だけ入れ替わる（2つ並ばない）
6. アプリのログアウト後、表示が消えることを確かめる

ロック画面ウィジェット（活動記録の accessory 枠・#979）の確認手順:
1. ロック画面を長押し ▸ カスタマイズ ▸ ロック画面 ▸ 時計の下の枠 / 時計の上の1行から「活動記録」を追加する
2. 記録中: 丸い枠に項目名の先頭2文字と経過時間、横長の枠に項目名と経過時間、1行の枠に項目名と経過時間が出る（経過時間が進み続ける）
3. 停止中: 丸い枠に「停止」と今日の合計、横長の枠に「記録していません」と今日の合計が出る

## 実機確認手順

- [ ] ビルドして本人のiPhoneへ入れ、本番YoteiFlowが起動する
- [ ] 「Googleでログイン」で認証シートが開き、許可アカウントでログインするとWebViewの起動画面へ入る
- [ ] アプリを完全終了して開き直してもログインしたまま
- [ ] ログアウト後に保護画面（`/calendar` 等）へ戻れない
- [ ] 許可リスト外のGoogleアカウントは「許可されていません」でログインできない
- [ ] 設定 ▸ Google Calendar で接続・再接続でき、予定の読み書きができる
- [ ] 外部リンクがSafariで開く／一度開いた画面が機内モードでも保存済みで開く（未保存の画面は再試行画面が出て、戻すと自動で読み込む）／低速回線で「保存済みを表示中」が出る／`confirm`（削除の確認）が出る／ノッチ・ホームバー周りが崩れない
- [ ] Safari・PWA・PCの既存ログイン、Calendar連携が今までどおり動く（アプリでログインしてもSafari側がログアウトされない）
- [ ] （#970）ウィジェットギャラリーの「今日の予定とタスク」を small / medium / large とロック画面に追加でき、予定とタスクが並ぶ。Notion未設定などで片方が出せなくても、もう片方は出る
- [ ] （#926）ログイン後にホーム画面へ「YoteiFlow」のウィジェット（活動記録・今日の予定・タスク・買い物リスト）を追加でき、中身が出る。ロック画面の枠でも出る
- [ ] （#926）記録中は経過時間が進み続け、タップでアプリの記録画面が開く（アプリが終了していても開く）
- [ ] （#926）ログアウトするとウィジェットが「アプリを開いてログインすると表示されます」に変わる。Scriptableのウィジェットは引き続き動く
- [ ] PRへ画面録画かスクリーンショットを添付する

## 初回スコープ外（後続Issue）

TestFlight配布のCI（macOSランナー）自動化 / APNsによるネイティブ通知（既存のWeb PushはPWA向けとして維持）/ （WidgetKitのウィジェットは #926、Live Activity は #971 で追加。既存のScriptableウィジェットも維持）/ App Store公開 / ネイティブ画面への置き換え。

## 自動テスト（XCTest）

`YoteiFlowTests`（単体テストTarget）と共有scheme `YoteiFlow`（`xcshareddata`）がある。テストは `Shared/` を同じバンドルへ取り込んで実行する純ロジックのみ（`LiveActivityReconcile`・`SharedConfig` のディープリンク検証）で、アプリ本体をホストにしない。実機・WebView・Keychainに依存するものは対象外。

```bash
xcodebuild test -project ios/YoteiFlow.xcodeproj -scheme YoteiFlow \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

subpc には Xcode が無く、Target は pbxproj を手で編集して足した。**Mac mini での `xcodebuild test` は未確認**（失敗したらpbxprojのTarget定義を疑う）。テストを足すときは `ios/YoteiFlowTests/` にファイルを置くだけでよい（同期グループ）。
