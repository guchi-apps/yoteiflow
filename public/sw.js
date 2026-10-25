/*
 * DaySpan の Service Worker（docs/spec.md §21）。
 *
 * 役割は「オンラインのときに開いた画面を、オフラインでも開けるようにする」ことだけに絞る。
 * next.config.mjs の experimental.useOffline は、ソフトナビゲーションと Server Actions を
 * オフライン中に保留して再接続後に送り直してくれるが、ページの再読み込み（コールドスタート）は
 * ブラウザがHTMLを取りにいくため、Service Worker が無いと必ず失敗する。そこを埋める。
 *
 * ただし「開いた画面」は、起動と再読み込みのときしかブラウザがHTMLを取りにいかない。
 * ナビからの移動はソフトナビゲーションで、そこでは何も保存されない。そのため画面側から
 * dayspan:warm を送ってもらい、開いている画面のHTMLをこちらで取って保存する（issue #321）。
 *
 * next-pwa / Serwist のようなビルド統合は使わず手書きしている。キャッシュしてよいものを
 * こちらで列挙できるほうが、認証付きのページや書き込みAPIを取り違えて保存する事故を防ぎやすい。
 *
 * オフライン中の編集を貯めて後から同期するキュー方式はMVP対象外（docs/spec.md §23）。
 * このファイルは書き込み（GET以外）にはいっさい介入しない。
 */

// キャッシュの世代。このファイルの保存方針を変えたときと、保存している応答の形が変わったときに
// 上げる。上げると activate で古い世代がまとめて消える。
//
// v3: タスクの紐づけが1件（link）から行き先ごとの配列（links）へ変わった（docs/spec.md §31）。
// 古い形の `/api/tasks` `/api/calendar` の応答を新しいJSへ渡すと、紐づけを読む場所で落ちる。
const VERSION = "v3";

const ASSET_CACHE = `dayspan-assets-${VERSION}`;
const PAGE_CACHE = `dayspan-pages-${VERSION}`;
const DATA_CACHE = `dayspan-data-${VERSION}`;
const CACHES = [ASSET_CACHE, PAGE_CACHE, DATA_CACHE];

// 保存する件数の上限。ページは表示形式×日付ぶん増えるため、際限なく貯めない。
const PAGE_LIMIT = 40;
const DATA_LIMIT = 40;

/**
 * ウォームアップ（dayspan:warm）で取り直さずに済ませる保存済みの新しさ。
 *
 * /calendar の描画はGoogle・Notionを叩く。画面を開くたびに温め直すと、外部APIへの往復が
 * 画面ぶんとウォームアップぶんで倍になる（docs/spec.md §20）。ハードナビゲーションで
 * 開いた直後は保存済みがこの範囲に入るため、何もせず終わる。
 */
const WARM_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * 通信が遅いとき、これだけ待っても届かなければ保存済みへ切り替える（issue #718）。
 *
 * 「電波は入っているが遅い」状態は `useOffline()` にも `navigator.onLine` にも現れず、
 * これまでは失敗しない限り骨組み・空欄のまま待たせ続けていた。オフラインと同じ保存済みへ
 * 倒す経路（networkFirst）へ、タイムアウトでの切り替えを足すだけで埋める。
 */
const SLOW_NETWORK_TIMEOUT_MS = 3000;

/**
 * レスポンスが保存済みの代用であることを示すヘッダー（issue #718）。タイムアウトに限らず、
 * 通信の失敗・5xxで保存済みを返すときも付ける（issue #1408）。
 */
const STALE_HEADER = "X-Dayspan-Stale";

/**
 * 書き込みのあとの取り直しであることを示す要求ヘッダー（issue #787）。
 *
 * これが付いたデータ要求は、SLOW_NETWORK_TIMEOUT_MS で保存済みへ倒さず最新が届くまで待つ。
 * 保存直後に保存前の保存済みを返すと、保存した予定の入っていない内容で「取り直せた」ことになり、
 * 次の自動更新まで画面に出なくなるため。待っている間も、保存した予定は画面側が楽観的に
 * 重ねて描いている（src/components/calendar/optimistic-events.ts）。通信に失敗したとき・
 * 5xxのときに保存済みへ倒すのは通常と同じで、そのときも STALE_HEADER を付ける（issue #1408）。
 */
const FRESH_HEADER = "X-Dayspan-Fresh";

/**
 * 内容が変わってもURLが変わらないもの。取得できたら差し替える（stale-while-revalidate）。
 * /_next/static/ はファイル名にハッシュが入るため、こちらではなくキャッシュ優先で扱う。
 */
const REVALIDATED_ASSETS = new Set([
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
  "/apple-icon",
]);

/**
 * いっさいキャッシュしないパス。
 *
 * 認証はCookieとリダイレクトで成立しているため、途中の応答を保存すると
 * ログイン状態を取り違える。外部サービスの接続操作も同じ理由で対象外にする。
 */
const NEVER_CACHE_PREFIXES = ["/auth/", "/login", "/api/google/", "/api/notion/", "/api/settings/"];

/**
 * オフラインでも読めるようにするGET API。応答はJSONで、認証は毎回サーバーが確認する。
 *
 * `/api/shopping` `/api/tasks/all` は買い物・タスク画面の一覧（issue #724）。画面はページで
 * Notion を待たず、ここから背景取得するため、通信が遅いときも保存済みを返せる。
 * 新しいパスを足すだけで保存する応答の形は変わらないため、VERSION は上げない。
 */
const CACHED_DATA_PATHS = new Set([
  "/api/calendar",
  "/api/tasks",
  "/api/shopping",
  "/api/tasks/all",
  // 勤務の月ごとの記録（issue #974）。月送りがRSC要求だと保存されず、オフライン・低速時に別の月を見られない。
  "/api/work/month",
  // 下部ナビの記録のクイックシートが開くときに読む項目と記録中の1件（issue #974）。
  "/api/activities",
]);

self.addEventListener("install", () => {
  // 事前に貯めるものは無い。新しい版を待たせる理由もないため、すぐ有効化へ進む。
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("dayspan-") && !CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  // ログアウト時に呼ぶ。別のアカウントで開いたときに前のユーザーの画面が出ないようにする。
  if (event.data?.type === "dayspan:clear-cache") {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(
          names.filter((name) => name.startsWith("dayspan-")).map((name) => caches.delete(name)),
        );
      })(),
    );
    return;
  }

  // 開いている画面から呼ぶ（issue #321）。その画面のHTMLを先に保存しておく。
  if (event.data?.type === "dayspan:warm") {
    event.waitUntil(warmPages(event.data.paths));
    return;
  }

  // エラー画面（src/app/error.tsx）から呼ぶ（issue #407）。そのページの保存済みを捨てる。
  if (event.data?.type === "dayspan:drop-page") {
    event.waitUntil(dropPages(event.data.paths));
  }
});

/**
 * 通知の受け取り（docs/spec.md §32）。
 *
 * iOS 18.4以降のSafariは、`web_push: 8030` を持つJSONをここを通さずにそのまま表示する
 * （Declarative Web Push）。それより前のiOSと他のブラウザはこのイベントを受け取るため、
 * 同じJSONの `notification` を読んで同じ通知を出す。送信側は端末を見分けない。
 *
 * 受け取ったら必ず通知を出す。出さない（サイレントな）プッシュが続くと、iOSは購読そのものを
 * 取り消す。届いたのに何も出さない経路を作らないため、中身が読めなくても既定の文面で出す。
 */
self.addEventListener("push", (event) => {
  const fallback = { title: "YoteiFlow", body: "" };

  let notification = fallback;
  if (event.data) {
    try {
      const payload = event.data.json();
      notification = payload?.notification ?? fallback;
    } catch {
      notification = { title: "YoteiFlow", body: event.data.text() };
    }
  }

  event.waitUntil(
    (async () => {
      if (typeof notification.app_badge === "number" && "setAppBadge" in self.registration) {
        // 0 は「今日までのタスクが無い」。clearAppBadge と同じで、印が消える。
        await self.registration.setAppBadge(notification.app_badge).catch(() => {});
      }

      await self.registration.showNotification(notification.title || "YoteiFlow", {
        body: notification.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        lang: notification.lang || "ja",
        // 同じ印の通知は新しいものが古いものを置き換える（記録中の1件など）。
        tag: notification.tag || undefined,
        data: { url: notification.navigate || "/" },
      });
    })(),
  );
});

/**
 * 通知を押したとき。
 *
 * すでに開いている画面があればそれを使う。新しく開くと、PWAでは同じアプリの窓が
 * 増えたように見えるうえ、記録中かどうかを見ていた画面から離れることになる。
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = new URL(event.notification.data?.url || "/", self.location.origin);

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of clients) {
        if (new URL(client.url).origin !== target.origin) continue;
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target.href).catch(() => {});
          return;
        }
      }

      await self.clients.openWindow(target.href);
    })(),
  );
});

/**
 * 送信先がブラウザ側で作り直されたとき。
 *
 * 新しい送信先を伝えないと、以後の通知はどこにも届かない。利用者が設定画面を開き直すまで
 * 気付けないため、ここで登録し直す。
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
      if (!applicationServerKey) return;

      try {
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        await fetch("/api/notifications/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(subscription.toJSON()),
        });
      } catch {
        // 失敗しても画面からやり直せる。ここで出せる通知は無い。
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // 書き込みには介入しない。オフラインでの送信はアプリ側が止める（docs/spec.md §21）。
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (REVALIDATED_ASSETS.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    return;
  }

  // ブラウザ自身のページ読み込み。ここを賄えると、オフラインでも起動・再読み込みができる。
  //
  // RSCヘッダが付く要求（ルーターのソフトナビゲーションと先読み）は対象外にする。
  // 応答の中身が Next-Router-State-Tree や先読みかどうかで変わり、
  // 別の状況で再生すると描画が壊れるため、保存したものを使い回せない。
  if (request.mode === "navigate" && !request.headers.has("RSC")) {
    // `/`（起動画面の判定・issue #637）は専用の扱いにする。networkFirst に混ぜないのは、
    // `/` の応答がredirectだけで自分のHTMLを持たず、isCacheable() の
    // `!response.redirected` により保存できないため（保存しないこと自体は正しい。redirect後の
    // 中身を`/`のキーで持つと、選んだ起動画面を変えても古い画面が返り続ける）。保存が無いぶん
    // オフライン・5xxのときに networkFirst の「保存済みへ倒す」が効かず、素通しだと
    // ブラウザのオフラインエラー画面に落ちてホーム画面のDaySpan自体が開けなくなる
    // （計画レビュー指摘）。
    if (url.pathname === "/") {
      event.respondWith(handleRootNavigate(request));
      return;
    }

    event.respondWith(networkFirst(event, PAGE_CACHE, PAGE_LIMIT, true));
    return;
  }

  if (CACHED_DATA_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(event, DATA_CACHE, DATA_LIMIT, false));
  }
});

/** 保存してよい応答か。リダイレクトの結果と部分応答は、そのまま返すと状態を取り違える。 */
function isCacheable(response) {
  return Boolean(response) && response.status === 200 && response.type === "basic" && !response.redirected;
}

/**
 * この端末のCookie（起動画面の記憶）が読めないときに倒す先（issue #637）。
 *
 * `src/lib/home-path.ts` の `DEFAULT_HOME_PATH` と同じ値。値を変えるときは両方直す
 * （`WIDGET_OPEN_BRIDGE_PATH` の写しと同じ扱い）。
 */
const DEFAULT_START_PATH = "/activity";

/**
 * `/`（起動画面の判定）専用のfetch処理（issue #637）。
 *
 * オンラインで届けば、そのままredirect応答を返す（ブラウザが `/activity` 等へ自動で
 * 移り、その要求は通常の networkFirst 経路を通る）。
 *
 * オフライン・5xxのときは、Cookieを読めない（fetchイベントの Request.headers から
 * Cookie ヘッダーは仕様上除かれる）ため、選んだ起動画面そのものへは倒せない。代わりに
 * `DEFAULT_START_PATH` への redirect 応答を返す。ブラウザはその応答を受けて改めて
 * `/activity` へナビゲートし、そちらは保存済みページ（`useWarmOfflinePage("/activity")`）を
 * 持っていれば開ける。持っていなければ、そこで初めてオフラインエラーになる
 * （従来どおり `/activity` が起動時の唯一の画面だったときと同じ挙動）。
 */
async function handleRootNavigate(request) {
  try {
    const response = await fetch(request);
    if (response.status >= 500) return redirectToDefaultStartPath();
    return response;
  } catch {
    return redirectToDefaultStartPath();
  }
}

function redirectToDefaultStartPath() {
  return Response.redirect(new URL(DEFAULT_START_PATH, self.location.origin).href, 302);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });

  const update = fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const response = await update;
  if (response) return response;
  throw new Error("offline");
}

/**
 * オンラインなら常に最新を返し、取れなかったとき・遅いときだけ保存済みを返す。
 *
 * ページとAPIはどちらもユーザーの最新の状態を映すものなので、キャッシュ優先にはしない。
 * 「オフラインだから」「通信が遅いから」以外の理由で古い内容が出ることは避ける。
 *
 * 3秒（SLOW_NETWORK_TIMEOUT_MS）以内に届けばそのまま返す。それより遅いときは、保存済みが
 * あればいったんそちらを返し、実際の取得は打ち切らず event.waitUntil() で完走させて保存だけ
 * 更新する（issue #718）。一度返した応答をあとから差し替える手段は無いため、次に開いたとき・
 * 次の自動更新サイクルで新しい内容になる。保存済みが無ければ、これまでどおり届くまで待つ。
 */
async function networkFirst(event, cacheName, limit, allowOtherQuery) {
  const request = event.request;
  const cache = await caches.open(cacheName);

  // 取得自体は3秒を超えても打ち切らない。タイムアウトで保存済みへ倒したあとも、
  // このPromiseは event.waitUntil() で生かして完走させ、保存を更新する。
  const attempt = fetch(request).then(async (response) => {
    if (isCacheable(response)) {
      await cache.put(request, response.clone());
      await trim(cache, limit);
    }
    return response;
  });

  const timedOut = Symbol("dayspan:timed-out");
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(timedOut), SLOW_NETWORK_TIMEOUT_MS);
  });

  // 書き込み後の取り直し（FRESH_HEADER）はタイムアウトで倒さない。
  const racers = request.headers.get(FRESH_HEADER) === "1" ? [attempt] : [attempt, timeout];

  let winner;
  try {
    winner = await Promise.race(racers);
  } catch (cause) {
    // タイムアウトより前に失敗した（オフライン等）。これまでどおり即座に保存済みへ倒す。
    // 保存済みであることは必ず伝える（issue #1408）。印が無いと画面が最新の応答とみなして
    // 表示を丸ごと置き換え、保存したばかりの予定・移動が保存前の内容で消える。
    clearTimeout(timer);
    const cached = await matchCached(cache, request, allowOtherQuery);
    if (cached) return withStaleHeader(cached);
    throw cause;
  }
  clearTimeout(timer);

  if (winner === timedOut) {
    const cached = await matchCached(cache, request, allowOtherQuery);
    if (cached) {
      event.waitUntil(attempt.catch(() => {}));
      return withStaleHeader(cached);
    }

    // 見せるものが無ければ、これまでどおり届くまで待つほかない。
    try {
      return await attempt;
    } catch (cause) {
      const fallback = await matchCached(cache, request, allowOtherQuery);
      if (fallback) return withStaleHeader(fallback);
      throw cause;
    }
  }

  const response = winner;

  // 5xx は「届いたが今は応えられない」。proxy.ts はSupabase Authへ届かずログイン状態を
  // 確認できなかったときにこれを返す。保存済みがあるならそちらを出す。エラー画面を出すと、
  // 通信が不安定なだけの利用者に「ログアウトされた」と受け取られる。
  if (response.status >= 500) {
    const cached = await matchCached(cache, request, allowOtherQuery);
    if (cached) return withStaleHeader(cached);
  }
  return response;
}

/**
 * 保存済みを代わりに返すとき、その旨をヘッダーで伝える（issue #718・#1408）。
 *
 * ページ（ハードナビゲーション）はこのヘッダーを読む手立てがクライアント側に無いため
 * 実質使われないが、データAPI（/api/calendar 等）はレスポンスを直接読む呼び出し元
 * （use-calendar-chunks.ts 等）がここを見て「保存済みを表示中」の印を出せる。
 */
function withStaleHeader(response) {
  const headers = new Headers(response.headers);
  headers.set(STALE_HEADER, "1");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 保存済みの応答を探す。
 *
 * ページは、同じURLが無ければ同じ画面の別の日付を出す（allowOtherQuery）。表示形式・日付が
 * 違っていても、まったく何も出ないよりは手掛かりになる。
 *
 * APIには同じことをしない。/api/calendar?months=… の応答を別の月の要求へ返すと、
 * use-calendar-chunks.ts の splitByMonth() が要求した月に該当しない項目をすべて捨てるため、
 * その月が「取得できて、予定が1件も無かった」ように見える。取れなかったことにするほうが正しい。
 */
async function matchCached(cache, request, allowOtherQuery) {
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  if (!allowOtherQuery) return undefined;

  return cache.match(request, { ignoreVary: true, ignoreSearch: true });
}

/** 上限を超えたぶんを古い順に捨てる。Cache API は追加した順に keys() を返す。 */
async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;

  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

/**
 * 指定したページを取りにいって PAGE_CACHE へ入れる（issue #321）。
 *
 * ナビの移動はソフトナビゲーション（RSC）で、ここでは保存できない。そのままだと、
 * 起動と再読み込み以外で開いた画面はいつまでもキャッシュに入らず、オフラインで開けない。
 * ページ側から自分のパスを渡してもらい、ブラウザのナビゲーションと同じURLで保存しておく。
 *
 * ここで作る Request にRSCヘッダは付かないため、返るのはHTMLの文書そのもの。
 * Service Worker 自身の fetch は fetch イベントを再入しないので、素通りの心配もない。
 */
async function warmPages(paths) {
  if (!Array.isArray(paths)) return;

  const cache = await caches.open(PAGE_CACHE);

  for (const path of paths) {
    if (typeof path !== "string" || !path.startsWith("/")) continue;

    const url = new URL(path, self.location.origin);
    if (url.origin !== self.location.origin) continue;
    if (NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) continue;

    if (await isFresh(cache, url.href)) continue;

    try {
      // 認証はCookieで成立している。Service Worker 内の Request は既定でも同一オリジンへ
      // Cookie を送るが、ここは取り違えると未ログインの応答（/login へのリダイレクト）を
      // 取り続けることになるため明示する。
      const response = await fetch(new Request(url.href, { credentials: "same-origin" }));
      if (!isCacheable(response)) continue;

      await cache.put(url.href, response);
      await trim(cache, PAGE_LIMIT);
    } catch {
      // オフラインなら取れなくて当然。保存済みがあればそれが使われる。
    }
  }
}

/**
 * 保存済みのページを捨てる（issue #407）。
 *
 * 画面を描く途中で投げた例外は、シェルがすでに流れていると HTTP 200 で返る
 * （ルートに loading.tsx があるため、勤務・カレンダーのように動的な画面は全てこの形になる）。
 * つまりエラーの面がそのまま「保存してよい応答」として PAGE_CACHE に入る。そのまま残すと、
 * 次にオフラインになったときや proxy.ts が5xxを返したときに、その画面はいつまでも
 * エラーの面を出し続ける。原因が直っても、保存済みだけが古い失敗を再生する。
 *
 * クエリ違いまでは消さない。月や日付が違う保存済みは、その回の失敗とは別に取れたもので、
 * オフラインのときの手掛かりとして残しておくほうがよい。
 */
async function dropPages(paths) {
  if (!Array.isArray(paths)) return;

  const cache = await caches.open(PAGE_CACHE);

  for (const path of paths) {
    if (typeof path !== "string" || !path.startsWith("/")) continue;

    const url = new URL(path, self.location.origin);
    if (url.origin !== self.location.origin) continue;

    await cache.delete(url.href, { ignoreVary: true });
  }
}

/** 保存済みが WARM_MAX_AGE_MS 以内に取れたものか。取得時刻は応答の date ヘッダーで見る。 */
async function isFresh(cache, url) {
  const cached = await cache.match(url, { ignoreVary: true });
  if (!cached) return false;

  const date = Date.parse(cached.headers.get("date") ?? "");
  // date が無い応答は新しさを判断できない。取り直して確実なものに入れ替える。
  if (Number.isNaN(date)) return false;

  return Date.now() - date < WARM_MAX_AGE_MS;
}
