import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import { buildOfflineWeekPlan, OFFLINE_WEEK_META_PATH } from "@/lib/offline-week";

/**
 * `public/sw.js` はモジュールではないため、vm で読み込んで関数を取り出す（issue #1489）。
 * Service Worker の環境は、読み込みと判定に要る分だけ差し込む。
 */
type FakeCache = {
  match(request: { url: string } | string): Promise<Response | undefined>;
  keys(): Promise<{ url: string }[]>;
};

const ORIGIN = "https://example.test";

function loadServiceWorker(week: Map<string, Response> = new Map()) {
  const cache: FakeCache = {
    match: async (request) => {
      const url = typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
      return week.get(url)?.clone();
    },
    keys: async () => [...week.keys()].map((url) => ({ url })),
  };

  const context = vm.createContext({
    self: { addEventListener() {}, location: { origin: ORIGIN } },
    caches: { open: async () => cache },
    Response,
    Headers,
    Request,
    URL,
    fetch: () => Promise.reject(new Error("offline")),
  });
  vm.runInContext(readFileSync("public/sw.js", "utf8"), context);
  return context as unknown as {
    weekFallbackKind(params: URLSearchParams, weekDateKey: string | null): string;
    newerResponse(a?: Response, b?: Response): Response | undefined;
    matchWeekData(request: { url: string }, cached?: Response): Promise<Response | undefined>;
  };
}

const kind = (query: string, weekDateKey: string | null = "2026-11-02") =>
  loadServiceWorker().weekFallbackKind(new URLSearchParams(query), weekDateKey);

function dated(body: string, date: string): Response {
  return new Response(body, { headers: { date } });
}

const WEEK_URL = `${ORIGIN}/api/calendar?view=day7&date=2026-11-02`;
const OLD = "Sun, 01 Nov 2026 00:00:00 GMT";
const NEW = "Mon, 02 Nov 2026 00:00:00 GMT";

test("1日・3日・週表示は、表示する日がすべて保存範囲に入るときだけ代用する", () => {
  // 保存範囲は 10/26〜11/15
  assert.equal(kind("view=day1&date=2026-11-08"), "cover");
  assert.equal(kind("view=day1&date=2026-10-26"), "cover");
  assert.equal(kind("view=day1&date=2026-11-15"), "cover");
  assert.equal(kind("view=day3&date=2026-11-13"), "cover");
  assert.equal(kind("view=day7&date=2026-11-09"), "cover");

  assert.equal(kind("view=day1&date=2026-10-25"), "none");
  assert.equal(kind("view=day1&date=2026-11-16"), "none");
  assert.equal(kind("view=day3&date=2026-11-14"), "none");
  assert.equal(kind("view=day7&date=2026-11-10"), "none");
});

test("月表示は保存範囲と重なる月を含むときだけ、同じURLの保存が無いときに代用する", () => {
  assert.equal(kind("months=2026-11"), "ifMissing");
  assert.equal(kind("months=2026-10,2026-11,2026-12"), "ifMissing");
  assert.equal(kind("months=2026-12"), "none");
  assert.equal(kind("months=2027-01,2027-02"), "none");
});

test("形の違う要求・保存は代用しない", () => {
  assert.equal(kind("view=month&date=2026-11-02"), "none");
  assert.equal(kind("view=day1"), "none");
  assert.equal(kind(""), "none");
  assert.equal(kind("view=day1&date=2026-11-02", null), "none");
});

test("新しいほうの応答を選ぶ", () => {
  const sw = loadServiceWorker();
  const older = dated("old", OLD);
  const newer = dated("new", NEW);
  assert.equal(sw.newerResponse(older, newer), newer);
  assert.equal(sw.newerResponse(newer, older), newer);
  assert.equal(sw.newerResponse(undefined, older), older);
  assert.equal(sw.newerResponse(older, undefined), older);
  assert.equal(sw.newerResponse(undefined, undefined), undefined);
});

test("見ていない日の要求は週の保存で返す", async () => {
  const sw = loadServiceWorker(new Map([[WEEK_URL, dated("week", NEW)]]));
  const response = await sw.matchWeekData({ url: `${ORIGIN}/api/calendar?view=day1&date=2026-11-05` });
  assert.equal(await response?.text(), "week");
});

test("日の要求は、同じURLの保存より新しければ週の保存を返す", async () => {
  const sw = loadServiceWorker(new Map([[WEEK_URL, dated("week", NEW)]]));
  const response = await sw.matchWeekData(
    { url: `${ORIGIN}/api/calendar?view=day1&date=2026-11-05` },
    dated("day", OLD),
  );
  assert.equal(await response?.text(), "week");
});

test("月の要求は、同じURLの保存があれば古くてもそちらを返す", async () => {
  const sw = loadServiceWorker(new Map([[WEEK_URL, dated("week", NEW)]]));
  const response = await sw.matchWeekData(
    { url: `${ORIGIN}/api/calendar?months=2026-11` },
    dated("month", OLD),
  );
  assert.equal(await response?.text(), "month");
});

test("範囲外の要求は取れなかったことにする", async () => {
  const sw = loadServiceWorker(new Map([[WEEK_URL, dated("week", NEW)]]));
  const response = await sw.matchWeekData({ url: `${ORIGIN}/api/calendar?view=day1&date=2026-12-20` });
  assert.equal(response, undefined);
});

test("週の保存が無い端末では、これまでどおり同じURLの保存だけを返す", async () => {
  const sw = loadServiceWorker();
  const cached = dated("day", OLD);
  assert.equal(
    await sw.matchWeekData({ url: `${ORIGIN}/api/calendar?view=day1&date=2026-11-05` }, cached),
    cached,
  );
  assert.equal(await sw.matchWeekData({ url: `${ORIGIN}/api/calendar?view=day1&date=2026-11-05` }), undefined);
});

test("カレンダー以外のAPIは同じURLの保存だけを見る", async () => {
  const shoppingUrl = `${ORIGIN}/api/shopping`;
  const sw = loadServiceWorker(
    new Map([
      [WEEK_URL, dated("week", NEW)],
      [shoppingUrl, dated("shopping", NEW)],
    ]),
  );
  assert.equal(await (await sw.matchWeekData({ url: shoppingUrl }))?.text(), "shopping");
  assert.equal(await sw.matchWeekData({ url: `${ORIGIN}/api/tasks/all` }), undefined);
});

test("控えのURLは sw.js と offline-week.ts で同じ", () => {
  const source = readFileSync("public/sw.js", "utf8");
  assert.ok(source.includes(`const WEEK_META_PATH = "${OFFLINE_WEEK_META_PATH}";`));
});

test("先取りするAPIは、すべて Service Worker が保存済みを返す対象に入っている", () => {
  const source = readFileSync("public/sw.js", "utf8");
  const plan = buildOfflineWeekPlan("2026-11-02", "Asia/Tokyo");
  for (const path of [plan.calendar, ...plan.data]) {
    const { pathname } = new URL(path, ORIGIN);
    assert.ok(source.includes(`"${pathname}",`), pathname);
  }
});

/** warmWeek() を動かすための、put・delete まで持つ環境。応答は `fetch` の差し替えで決める。 */
function loadWarmEnvironment(respond: (url: string) => Response | Error) {
  const stores = new Map<string, Map<string, Response>>();
  const fetched: string[] = [];
  const hrefOf = (request: { url: string } | string) =>
    typeof request === "string" ? new URL(request, ORIGIN).href : request.url;

  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      match: async (request: { url: string } | string) => store.get(hrefOf(request))?.clone(),
      put: async (request: { url: string } | string, response: Response) => {
        store.set(hrefOf(request), response);
      },
      delete: async (request: { url: string } | string) => store.delete(hrefOf(request)),
      keys: async () => [...store.keys()].map((url) => ({ url })),
    };
  };

  const context = vm.createContext({
    self: { addEventListener() {}, location: { origin: ORIGIN } },
    caches: { open },
    Response,
    Headers,
    URL,
    // Request の生成は相対URLを受けないため、URLだけを持つ形で差し替える。
    Request: function (input: string) {
      return { url: new URL(input, ORIGIN).href };
    },
    fetch: async (request: { url: string }) => {
      fetched.push(request.url);
      const result = respond(request.url);
      if (result instanceof Error) throw result;
      // isCacheable() は type === "basic" を見るが、組み立てた Response は "default" のため合わせる。
      Object.defineProperty(result, "type", { value: "basic" });
      return result;
    },
  });
  vm.runInContext(readFileSync("public/sw.js", "utf8"), context);

  const sw = context as unknown as { warmWeek(plan: unknown): Promise<void> };
  const week = () => stores.get("dayspan-week-v3") ?? new Map<string, Response>();
  return { sw, week, fetched };
}

const PLAN = { ...buildOfflineWeekPlan("2026-11-02", "Asia/Tokyo"), pages: [] };
const okCalendar = () => new Response(JSON.stringify({ errors: [] }), { status: 200 });

test("先取りはカレンダー・APIを保存し、控えを残す。間引きの間は取り直さない", async () => {
  const env = loadWarmEnvironment((url) =>
    url.includes("/api/calendar") ? okCalendar() : new Response("{}", { status: 200 }),
  );
  await env.sw.warmWeek(PLAN);

  assert.ok(env.week().has(new URL(PLAN.calendar, ORIGIN).href));
  assert.ok(env.week().has(`${ORIGIN}/api/shopping`));
  assert.ok(env.week().has(`${ORIGIN}${OFFLINE_WEEK_META_PATH}`));

  const count = env.fetched.length;
  await env.sw.warmWeek(PLAN);
  assert.equal(env.fetched.length, count);
});

test("カレンダーに一部失敗があれば、保存も控えも残さない", async () => {
  const env = loadWarmEnvironment((url) =>
    url.includes("/api/calendar")
      ? new Response(JSON.stringify({ errors: [{ source: "notion" }] }), { status: 200 })
      : new Response("{}", { status: 200 }),
  );
  await env.sw.warmWeek(PLAN);

  assert.equal(env.week().has(new URL(PLAN.calendar, ORIGIN).href), false);
  assert.equal(env.week().has(`${ORIGIN}${OFFLINE_WEEK_META_PATH}`), false);
});

test("届かなかったときは残りを取りにいかず、通信が戻ればすぐ取り直せる", async () => {
  let online = false;
  const env = loadWarmEnvironment((url) => {
    if (!online) return new Error("offline");
    return url.includes("/api/calendar") ? okCalendar() : new Response("{}", { status: 200 });
  });

  await env.sw.warmWeek(PLAN);
  assert.equal(env.fetched.length, 1);

  online = true;
  await env.sw.warmWeek(PLAN);
  assert.ok(env.week().has(new URL(PLAN.calendar, ORIGIN).href));
});

test("今回の対象から外れた保存は掃除で消える", async () => {
  const env = loadWarmEnvironment((url) =>
    url.includes("/api/calendar") ? okCalendar() : new Response("{}", { status: 200 }),
  );
  await env.sw.warmWeek(PLAN);

  const stale = `${ORIGIN}/api/work/month?month=2026-10`;
  env.week().set(stale, new Response("{}"));
  const sw = env.sw as unknown as {
    cleanWeekCache(cache: unknown, keep: string[]): Promise<void>;
    caches: { open(name: string): Promise<unknown> };
  };
  await sw.cleanWeekCache(await sw.caches.open("dayspan-week-v3"), [PLAN.calendar, ...PLAN.data]);

  assert.equal(env.week().has(stale), false);
  assert.ok(env.week().has(`${ORIGIN}/api/shopping`));
});
