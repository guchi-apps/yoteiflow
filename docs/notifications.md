# 通知（Web Push）の設定と確認

予定の前とタスクの期限に知らせる機能（docs/spec.md §32）の、鍵の作り方と動作確認の手順。

- 経緯: guchi-apps/koyomio#345
- 実装: `src/lib/web-push/`（送信）・`src/services/notifications/`（下書き・送信・設定）・`public/sw.js`（受け取り）
- 依存パッケージは追加していない。VAPIDの署名（RFC 8292）とペイロードの暗号化（RFC 8291）は `node:crypto` で行う

## 鍵（VAPID）

送信には3つの環境変数が要る。**未設定でも他の機能は動く**（通知だけが使えない）。

| 変数 | 内容 |
| --- | --- |
| `VAPID_PUBLIC_KEY` | ブラウザの `subscribe()` へ渡す公開鍵。65バイトの非圧縮点をbase64urlにした1行 |
| `VAPID_PRIVATE_KEY` | 署名に使う秘密鍵。32バイトをbase64urlにした1行 |
| `VAPID_SUBJECT` | 送信先が見る連絡先。`mailto:` か `https://` で始める |

PEMではなく1行のbase64urlで持つ。PEMを環境変数へ入れると改行が `\n` の文字列になり、
復元し損ねたときに「鍵が途中で切れている」形の失敗になる（signalyが踏んでいる）。

### 作る

```bash
node scripts/gen-vapid-keys.mjs mailto:自分のメールアドレス
```

出力の3行を、ローカルは `.env.local` へ、本番は1Password（`apps/dayspan` の
`vapid-public-key` / `vapid-private-key` / `vapid-subject`）へ入れる。

**鍵を作り直すと、それまでに登録された端末には届かなくなる。** 購読はブラウザ側が公開鍵と
結び付けて作るため、設定画面で登録し直してもらう必要がある。

### 本番へ配る

1Passwordが正で、GitHub Secretsへは `.github/secrets-manifest.tsv` の対応表に沿って同期する。

```bash
# GitHub Actions から起こす（1Passwordの読み取りだけなのでサービスアカウントで足りる）
gh workflow run sync-secrets.yml -f only=VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY,VAPID_SUBJECT

# 手元から直接叩く場合。個人アカウントのセッションが要る
# （OP_SERVICE_ACCOUNT_TOKEN があると op の書き込みだけが全部失敗する）
unset OP_SERVICE_ACCOUNT_TOKEN && eval "$(op signin)"
scripts/sync-github-secrets.sh --only VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY,VAPID_SUBJECT
```

同期したあとデプロイすると、`.github/workflows/deploy.yml` の `update_env` が本番の `.env` へ書く。

**同期を忘れると、デプロイは空文字をそのまま `.env` へ書く。** 起動には要らない値のため何も落ちず、
設定画面に「鍵が設定されていません」と出るだけになる（#359 はこの状態が続いていた）。
デプロイのたびに `secrets-check` ジョブ（`.github/scripts/check-repo-secrets.sh`）が
マニフェストの `repo` 項目と突き合わせ、空のものがあればSignalyへ1通出す（値そのものは出さない）。

### 「鍵が設定されていません」と出たとき

設定画面のこの文言は、`VAPID_*` の3つが揃っていないか、鍵の対が食い違っているかのどちらかを指す。
次の順に確かめると最短で分かれる。

```bash
gh secret list
```

1. `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` が並ばない → 同期されていない（→「本番へ配る」）。
   **1Passwordに入っているかどうかは判定にならない。** 入っていても同期しなければ本番には届かない。
   #359 と #400 はどちらもこの状態で、1Password側の3つは最初から揃っていた。
2. 3つ並ぶのに出る → 同期より後にデプロイしたか。Secretsは既に終わったデプロイへは遡って効かない。
   本番の `.env` は次のデプロイで `update_env` が書き直すまで空文字のまま残る。
3. それでも出る → 鍵の対が食い違っている（→「公開鍵と秘密鍵の食い違い」）。
   サーバーログに `[dayspan] VAPID keys are unusable:` が出る。

**デプロイが緑であることは、値が揃っている根拠にならない。** `secrets-check` は空の値を見つけても
warning を出すだけでジョブは success のまま終わる（無くても他の機能が動く値を含むため、デプロイを
止めない判断。`.github/workflows/deploy.yml`）。空だったことが残るのはSignalyの1通と
Actionsのログの warning だけで、画面にも本番のログにも出ない。

### 公開鍵と秘密鍵の食い違い

別々の環境変数にあるため、片方だけ入れ替わっていても値としては読める。その状態では
**購読は作れるのに配信だけが落ち続け、画面には何も出ない。**

`src/lib/web-push/keys.ts` は秘密鍵から公開鍵を計算し直して突き合わせ、食い違っていれば
読み込みの時点で断る（設定画面では「鍵が未設定」と同じ扱いになる）。

> JWKで `x`・`y` を渡す形では、Nodeはその値が `d` と対になっているかを確かめずに受け取る。
> 書かれている値どうしを比べても食い違いは見つからないため、`createECDH` で計算し直している。

## 送信の中身を確かめる（ブラウザ不要）

```bash
node --experimental-strip-types scripts/check-web-push.mjs
```

RFC 8291 §5 に載っている「鍵・salt・平文・出来上がりのボディ」をそのまま通し、1バイトでも違えば
落ちる。VAPIDの署名も、その場で作った鍵で署名して同じ鍵で検証する。

実機で通知が出ないときは、まずこれを実行する。通れば**送信の中身は正しい**ため、原因は
端末側（ホーム画面に追加していない・通知を許可していない・購読が失効している）に絞れる。

## iPhoneでの確認

1. Safariで本番のDaySpanを開き、共有ボタンから「ホーム画面に追加」
2. **追加したアイコンから開く**（Safariのタブのままでは、iOSが通知の許可を出せない）
3. 設定 → 通知 → 「この端末で受け取る」を入れる。iOSの許可ダイアログで「許可」
4. 「テスト通知」を送る。数秒で1通届き、アイコンにバッジ（期限が今日以前のタスクの件数）が付く

出ないときの切り分け:

| 症状 | 見るところ |
| --- | --- |
| 設定画面に「鍵が設定されていません」と出る | `gh secret list` に `VAPID_*` が3つあるか → 1Passwordの `apps/dayspan` に `vapid-*` があるか → 本番の `.env` の3行（#359） |
| スイッチが押せない | ホーム画面のアイコンから開いているか。画面上部に理由が出る |
| 許可したのに届かない | `scripts/check-web-push.mjs`、次に本番の `.env` の3つの値 |
| 一度は届いたが止まった | 購読が失効している可能性。スイッチを入れ直す（失効した登録はサーバー側で自動的に消える） |
| バッジだけ出ない | iOSの「設定 > 通知 > DaySpan > バッジ」。通知を許可していてもバッジだけ切れる |

## 送信を手で走らせる

通常はアプリ内のタイマー（`src/instrumentation.ts`）が毎分呼ぶ。手で1回ぶん走らせるには、
サーバー間参照用APIの共有シークレット（docs/internal-api.md）を使う。

```bash
curl -s -X POST -H "Authorization: Bearer $INTERNAL_API_KEY" \
  "http://127.0.0.1:3113/api/internal/notifications/dispatch"
```

二重に走っても、送信済みの印を送る前に立てているため同じ通知は2回送られない。

## 開発環境での制限

- Service Workerは本番ビルドでのみ登録する（`src/components/offline/service-worker.tsx`）。
  `pnpm dev` では購読を作れず、設定画面のスイッチは理由を出して止まる
- ローカルで最後まで試すなら `pnpm build && pnpm start` で動かし、HTTPSで到達できるホスト名から開く

## iOSアプリ（APNs）

WKWebViewの中ではWeb Push（Service Workerの `push`）が動かないため、iOSアプリ（`ios/`）はAPNsで通知を受ける（#925）。
Web Push（PWA・ブラウザ）はそのまま残し、同じ文面（`sendToUser()` の入力）を両方へ送る。

### 仕組み

1. アプリはログイン後の最初の画面が開けたところで通知の許可を求め、許可されたらAPNsへ登録する
2. 受け取ったデバイストークンを、ログイン済みのWebViewから `POST /api/notifications/apns`（`token` と `environment`）で渡す。
   `ApnsDevice` に1端末1行で保存する。`environment` はXcodeから入れた開発ビルドが `sandbox`、TestFlight・App Storeが `production`
   （トークンは環境をまたいで使えない。サーバーはこの値で送り先のホストを分ける）
3. 送信は `src/lib/apns/`（`node:http2` でAPNsへ直接。新しい依存は足していない）。通知の文面・時刻・バッジの件数は
   Web Pushと共通で、`NotificationJob` の下書きもそのまま使う
4. 通知を押すとペイロードの `path`（`/calendar?date=…` など）をWebViewで開く。相対パス以外は開かない

### 鍵（認証キー）

Apple Developer ▸ Certificates, Identifiers & Profiles ▸ Keys で「Apple Push Notifications service (APNs)」を有効にした
キーを発行する（.p8 のダウンロードは1回きり）。`APNS_KEY_ID`（10文字）・`APNS_TEAM_ID`・`APNS_PRIVATE_KEY`（.p8 の中身）は、同じTeamのアプリ（kurashio・morrow）と共通の1Passwordのアイテム `apps/AppStoreConnect`（`apns-key-id`・`apns-team-id`・`apns-auth-key`。`apns-auth-key` はbase64の1行）を参照する（キーはTeam単位で共有できるため・#957・#1273）。`sync-secrets.yml` で同期する（手順は `docs/setup-checklist.md`）。
Bundle ID（`com.gucchii.yoteiflow`）は既定値で、変える場合だけ `APNS_BUNDLE_ID` を足す。
鍵が未設定の環境では、APNsへは送らず登録APIは503を返す（Web Pushだけで動く）。
App IDの Push Notifications capability はXcodeの自動署名が有効にする（`ios/YoteiFlow.entitlements`）。

### PWAとアプリの二重通知

同じ端末にアプリとホーム画面のPWAが並ぶと同じ通知が2通届く。端末ごとの設定は持たず、**アプリ（APNs）が届いている
端末の系統（iPhone / iPad）では、同じ系統のWeb Pushの購読へは送らない**（`src/services/notifications/delivery.ts`）。
系統は登録時のUser-Agentから決め、分からない購読（PC等）は外さない。APNsのトークンが失効して消えたときは、
その系統のWeb Pushへ自動で戻る。副作用として、iPhoneのアプリを入れている間はiPhoneのPWAへは届かない
（アプリを消すか、トークンが失効すればPWAが再び受ける）。

### 設定画面からのオン・オフ（#968）

WKWebViewにはPush APIが無く、設定 ▸ 通知の `usePushSubscription` は `PushManager` が無いと
「この端末では通知を扱えません」になっていた。アプリの中（ブリッジのハンドラがある）ときは、スイッチを
`WKScriptMessageHandlerWithReply`（名前 `yoteiflowPush`・`src/lib/native-push.ts`）経由でアプリへ頼む。

- `status`: 許可の状態（`notDetermined` / `denied` / `granted`）と、サーバーへ登録できているか（200のときだけ）。
  起動直後で自動登録が済んでいなければ、許可済みのときだけ済むまで（上限5秒）待ってから返す
- `enable`: 起動1回きりの guard を通らず、許可の確認（未決定なら尋ねる）→ `registerForRemoteNotifications` →
  トークン到着待ち（失敗・10秒で返事）→ POST を毎回行う。拒否済みなら `denied` を返し、画面は「設定 > 通知」へ案内する
- `disable`: `DELETE /api/notifications/apns`（404は解除済みとして成功）。`unregisterForRemoteNotifications` は呼ばない
  （サーバーの行を消せば送信は止まる）。UserDefaultsの `pushOptOut` を立て、起動・画面の読み込みのたびの自動の許可要求と
  トークン登録を止める（オンにすると外れる）

「繰り返さない」印（`registeredToken`・401以外で立つ）と「サーバーに登録できた」印（`serverRegisteredToken`・200のみ）は分けている。
前者を「登録済み」の根拠にすると、鍵が未設定（503）でも登録済みと答えてしまうため。

アプリでオフにしてApnsDeviceの行が消えると、同じ系統（iPhone / iPad）のWeb Pushを外す理由（上記）も無くなる。
同じ端末のPWAの購読が生きていれば、そちらへ通知が届く（許容した挙動。止めるにはPWAの画面で別にオフにする）。
通知画面・設定一覧の登録端末数は `countNotificationDevices()`（Web Push＋APNs）で数える。

### バッジ・取り消し

バッジの件数は `aps.badge` で同じ値（期限が今日以前のタスク＋買い物）を送る。アプリ（WKWebView）では
Webの `setAppBadge` が使えないため、バッジが更新されるのは通知が届いたときだけ（開いたときの取り直しは無い）。
iOSがWeb Pushで「通知を出さないプッシュが続くと購読を取り消す」挙動は、APNsでは `apns-push-type: alert` の
通常の通知だけを送っているため当てはまらない（サイレントプッシュ・バックグラウンド更新は使っていない）。
ただし通知の許可をユーザーが切った端末はトークンがそのまま残り、送っても表示されない（`BadDeviceToken` /
`Unregistered` が返れば自動で消える）。

### 既知の制限

- ログアウトしてもトークンは消さない。別アカウントでログインするとトークンの持ち主が書き換わる（`saveApnsDevice`）が、
  ログアウトしたまま放置した端末には前の利用者の通知が届き続ける
- 実機・APNsの本番との疎通はこの環境（Xcode・Apple Developerが無い）では確かめていない。TestFlightで確認する（#910）
