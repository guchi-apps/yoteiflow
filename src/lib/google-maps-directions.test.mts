import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateMinutes,
  extractDirectionsUrl,
  fetchGoogleMapsDirections,
  parseDirectionsResponse,
  parseDurationText,
  scheduleCandidate,
  type DirectionsCandidate,
} from "@/lib/google-maps-directions";
import { resolveGoogleMapsShare } from "@/lib/share-import/google-maps";

const TZ = "Asia/Tokyo";

/** 実リンクの応答（`/maps/preview/directions`）の形を、個人の地点を除いて再現した固定データ。 */
function candidate(options: {
  name: string;
  meters: number;
  distance: string;
  rep: [number, string];
  range?: [number, number, string];
  /** 反対側の時刻（実UNIX秒）。無ければ省略 */
  other?: number;
  /** 時間ブロック内の位置（出発指定は7、到着指定は8） */
  otherIndex?: 7 | 8;
}) {
  const block: unknown[] = [options.rep, null, 2, [2000, "33 分"], options.range ?? null, [options.rep[0]], null, null, null];
  if (options.other !== undefined) block[options.otherIndex ?? 7] = [options.other, "Asia/Tokyo", "x", 32400, options.other];
  return [0, options.name, [options.meters, options.distance, 0], [2800, "47 分"], null, null, null, [], null, null, block];
}
const wrap = (...candidates: unknown[]) => `)]}'\n${JSON.stringify([[[candidates]], "手順", [0, "<step>左折</step>", [1, "1 m", 0], [1, "1 秒"]]])}`;

// 出発指定 14:08（現地）。3候補とも範囲 35分〜1時間20分・到着15:28（=UTC 06:28）
const departResponse = wrap(
  candidate({ name: "国道170号", meters: 18527, distance: "18.5 km", rep: [3000, "50 分"], range: [2100, 4800, "35 分～1 時間 20 分"], other: 1791354480 }),
  candidate({ name: "府道16号", meters: 18738, distance: "18.7 km", rep: [3300, "55 分"], range: [2100, 4800, "35 分～1 時間 20 分"], other: 1791354480 }),
);
// 到着指定 12:30（現地）。候補ごとに出発が違う（10:20 / 9:50 / 10:00）
const arriveResponse = wrap(
  candidate({ name: "国道422号", meters: 78129, distance: "78.1 km", rep: [6600, "1 時間 50 分"], range: [5400, 7800, "1 時間 30 分～2 時間 10 分"], other: 1791508800, otherIndex: 8 }),
  candidate({ name: "国道163号", meters: 60552, distance: "60.6 km", rep: [7200, "2 時間"], range: [5400, 9600, "1 時間 30 分～2 時間 40 分"], other: 1791507000, otherIndex: 8 }),
  candidate({ name: "京滋バイパス", meters: 72480, distance: "72.5 km", rep: [6600, "1 時間 50 分"], range: [5400, 9000, "1 時間 30 分～2 時間 30 分"], other: 1791507600, otherIndex: 8 }),
);

const departSchedule = { basis: "depart", local: "2026-10-07T14:08" } as const;
const arriveSchedule = { basis: "arrive", local: "2026-10-09T12:30" } as const;

test("候補を読み、手順の行は候補にしない", () => {
  const candidates = parseDirectionsResponse(departResponse);
  assert.deepEqual(candidates.map((item) => item.name), ["国道170号", "府道16号"]);
  assert.equal(candidates[0].distanceText, "18.5 km");
  assert.deepEqual(candidates[0].rangeMinutes, { min: 35, max: 80 });
  assert.equal(candidates[0].representativeMinutes, 50);
});

test("出発指定14:08＋代表50分＝14:58（予測幅の上限80分＝15:28にならない・9時間ずれない）", () => {
  const [first] = parseDirectionsResponse(departResponse);
  const times = scheduleCandidate(first, departSchedule, TZ);
  assert.equal(times.startAt, "2026-10-07T05:08:00.000Z"); // 14:08 JST
  assert.equal(times.endAt, "2026-10-07T05:58:00.000Z"); // 14:58 JST
  assert.equal(times.minutes, 50);
});

test("到着指定12:30−代表110分＝10:40（Googleが返す反対側の時刻で上書きしない）", () => {
  const candidates = parseDirectionsResponse(arriveResponse);
  const kyoshi = candidates.find((item) => item.name === "京滋バイパス")!;
  const times = scheduleCandidate(kyoshi, arriveSchedule, TZ);
  assert.equal(times.endAt, "2026-10-09T03:30:00.000Z"); // 12:30 JST
  assert.equal(times.minutes, 110);
  assert.equal(times.startAt, "2026-10-09T01:40:00.000Z"); // 12:30 − 1時間50分 = 10:40 JST
});

test("検証例: 到着12:30で 1時間50分→10:40 / 2時間→10:30 / 1時間50分→10:40", () => {
  const make = (minutes: number): DirectionsCandidate => ({
    name: "", distanceMeters: null, distanceText: null, rangeMinutes: { min: 60, max: 200 }, rangeText: null,
    representativeMinutes: minutes, representativeText: null, otherEndEpoch: null, timeZone: null,
  });
  const jst = (iso: string | null) => new Date(new Date(iso!).getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
  for (const [minutes, start] of [[110, "10:40"], [120, "10:30"], [110, "10:40"]] as const) {
    const times = scheduleCandidate(make(minutes), arriveSchedule, TZ);
    assert.equal(jst(times.startAt), start);
    assert.equal(jst(times.endAt), "12:30");
  }
});

test("代表時間から逆算・加算する（日付またぎ含む・予測幅は使わない）", () => {
  const base: DirectionsCandidate = {
    name: "", distanceMeters: null, distanceText: null, rangeMinutes: { min: 30, max: 90 }, rangeText: null,
    representativeMinutes: 60, representativeText: null, otherEndEpoch: null, timeZone: null,
  };
  // 23:30出発＋60分＝翌0:30
  const forward = scheduleCandidate(base, { basis: "depart", local: "2026-10-07T23:30" }, TZ);
  assert.equal(forward.endAt, "2026-10-07T15:30:00.000Z");
  // 0:30到着−60分＝前日23:30
  const backward = scheduleCandidate(base, { basis: "arrive", local: "2026-10-08T00:30" }, TZ);
  assert.equal(backward.startAt, "2026-10-07T14:30:00.000Z");
});

test("代表時間だけを使い、範囲だけで代表時間が無ければ未取得（null）。日時が無ければ時刻は決めず所要時間だけ返す", () => {
  const single: DirectionsCandidate = {
    name: "", distanceMeters: null, distanceText: null, rangeMinutes: null, rangeText: null,
    representativeMinutes: 42, representativeText: null, otherEndEpoch: null, timeZone: null,
  };
  assert.equal(candidateMinutes(single), 42);
  assert.equal(candidateMinutes({ ...single, representativeMinutes: null, rangeMinutes: { min: 30, max: 90 } }), null);
  assert.deepEqual(scheduleCandidate(single, null, TZ), { startAt: null, endAt: null, minutes: 42 });
  assert.equal(scheduleCandidate(single, departSchedule, TZ).minutes, 42);
});

test("時間が全く取れないときは、固定側（指定日時）だけを返す", () => {
  const none: DirectionsCandidate = {
    name: "", distanceMeters: null, distanceText: null, rangeMinutes: null, rangeText: null,
    representativeMinutes: null, representativeText: null, otherEndEpoch: null, timeZone: null,
  };
  assert.deepEqual(scheduleCandidate(none, arriveSchedule, TZ), { startAt: null, endAt: "2026-10-09T03:30:00.000Z", minutes: null });
});

test("形が違う・壊れた応答は空として扱う（例外にしない）", () => {
  assert.deepEqual(parseDirectionsResponse(")]}'\nnot json"), []);
  assert.deepEqual(parseDirectionsResponse(")]}'\n[[1,2,3]]"), []);
});

test("経路データの取得先はGoogle Mapsのpreview/directionsだけを採る", () => {
  const html = `<script>fetch("preview/directions?authuser=0&amp;hl=ja&amp;pb=!1m4")</script>`;
  const url = extractDirectionsUrl(html);
  assert.ok(url?.startsWith("https://www.google.com/maps/preview/directions?authuser=0&hl=ja"));
  assert.equal(extractDirectionsUrl("<html>なし</html>"), null);
});

test("fetch: 許可していないホスト・失敗・形式変更は取得失敗として返す", async () => {
  assert.deepEqual(await fetchGoogleMapsDirections("https://example.com/maps/dir/a/b"), { ok: false, reason: "not_directions_page" });
  const failing = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
  assert.deepEqual(await fetchGoogleMapsDirections("https://www.google.com/maps/dir/a/b", { fetch: failing }), { ok: false, reason: "request_failed" });
  const changed = (async () => new Response("<html></html>", { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await fetchGoogleMapsDirections("https://www.google.com/maps/dir/a/b", { fetch: changed }), { ok: false, reason: "unreadable" });
});

const dirUrl = (basis: 0 | 1, epoch: number) =>
  `https://www.google.com/maps/dir/34.84,135.61/Dest/data=!4m1!2m4!6e${basis}!7e2!8j${epoch}!11b1!3e0`;
const share = (url: string, response: string) =>
  resolveGoogleMapsShare(url, {
    expand: async (value, parse) => ({ result: parse(value)!, url: value }),
    directions: async () => ({ ok: true, candidates: parseDirectionsResponse(response) }),
    analyze: async () => assert.fail("Googleの予測が取れたときはAIを使わない"),
  }, TZ);

test("共有（出発指定）: 候補が複数なら自動で確定せず、指定の出発日時だけ保持する。選んだ候補は14:08＋代表50分＝14:58", async () => {
  const result = await share(dirUrl(0, 1791382080), departResponse);
  assert.ok(result.ok);
  const { item } = result;
  assert.equal(item.candidates?.length, 2);
  assert.equal(item.registrable, false);
  assert.equal(item.durationMinutes, null);
  assert.equal(item.scheduleBasis, "depart");
  assert.equal(item.startAt, "2026-10-07T05:08:00.000Z"); // 固定側（出発14:08）だけ
  assert.equal(item.endAt, null);
  const [first] = item.candidates ?? [];
  assert.equal(first.minutes, 50);
  assert.equal(first.endAt, "2026-10-07T05:58:00.000Z"); // 14:58（予測の上限15:28にならない）
  assert.equal(first.representativeText, "50 分");
  assert.equal(first.rangeText, "35 分～1 時間 20 分");
  assert.match(item.detail ?? "", /^https:\/\/www\.google\.com\/maps\/dir\//);
});

test("共有（1候補）: その候補を採用し、14:08〜14:58・GOOGLE_MAPS・予測幅は参考として保持する", async () => {
  const [only] = parseDirectionsResponse(departResponse);
  const result = await resolveGoogleMapsShare(dirUrl(0, 1791382080), {
    expand: async (value, parse) => ({ result: parse(value)!, url: value }),
    directions: async () => ({ ok: true, candidates: [only] }),
    analyze: async () => assert.fail("Googleの予測が取れたときはAIを使わない"),
  }, TZ);
  assert.ok(result.ok);
  const { item } = result;
  assert.equal(item.startAt, "2026-10-07T05:08:00.000Z");
  assert.equal(item.endAt, "2026-10-07T05:58:00.000Z");
  assert.equal(item.durationMinutes, 50);
  assert.equal(item.estimateSource, "GOOGLE_MAPS");
  assert.equal(item.registrable, true);
  assert.equal(item.candidates, null);
  assert.match(item.detail ?? "", /代表時間: 50 分/);
  assert.match(item.detail ?? "", /（参考）予測幅: 35 分～1 時間 20 分/);
});

test("共有（到着指定）: 3候補は選択式で、代表時間から 10:40 / 10:30 / 10:40 を作る", async () => {
  const result = await share(dirUrl(1, 1791549000), arriveResponse);
  assert.ok(result.ok);
  const { item } = result;
  assert.equal(item.registrable, false);
  assert.equal(item.durationMinutes, null);
  assert.equal(item.startAt, null);
  assert.equal(item.endAt, "2026-10-09T03:30:00.000Z"); // 固定側（到着12:30）だけ
  assert.equal(item.candidates?.length, 3);
  const byName = Object.fromEntries((item.candidates ?? []).map((candidate) => [candidate.name, candidate]));
  assert.equal(byName["国道422号"].startAt, "2026-10-09T01:40:00.000Z"); // 10:40
  assert.equal(byName["国道422号"].minutes, 110);
  assert.equal(byName["国道163号"].startAt, "2026-10-09T01:30:00.000Z"); // 10:30
  assert.equal(byName["国道163号"].minutes, 120);
  assert.equal(byName["京滋バイパス"].startAt, "2026-10-09T01:40:00.000Z"); // 10:40（他候補の値が混ざらない）
  for (const candidate of item.candidates ?? []) assert.equal(candidate.endAt, "2026-10-09T03:30:00.000Z");
  assert.match(item.notice ?? "", /1つ選んでください/);
});

test("取得失敗: 発着地を保ち、日時・所要時間は未取得と明示してAIの値を確定扱いしない", async () => {
  const result = await resolveGoogleMapsShare(dirUrl(0, 1791382080), {
    expand: async (value, parse) => ({ result: parse(value)!, url: value }),
    directions: async () => ({ ok: false, reason: "request_failed" }),
    analyze: async () => null,
  }, TZ);
  assert.ok(result.ok);
  assert.equal(result.item.origin, "34.84,135.61");
  assert.equal(result.item.destination, "Dest");
  assert.equal(result.item.registrable, false);
  assert.equal(result.item.estimateSource, null);
  assert.equal(result.item.startAt, "2026-10-07T05:08:00.000Z"); // 固定側（指定の出発日時）だけ
  assert.equal(result.item.endAt, null);
  assert.match(result.item.notice ?? "", /所要時間/);
});

// 徒歩・自転車・公共交通の応答（issue #1213）。車の時間ブロックが無く、経路の一覧は root[0][1][i][0]。
// 中の手順も `[手段,"",[距離],[秒,"表示"]]` の同じ形をしているが、候補にしない。
const plainStep = (mode: number) => [mode, "", [15, "15 m", 0], [12, "12 秒"]];
const plainResponse = (...routes: unknown[][]) =>
  `)]}'\n${JSON.stringify([[null, routes.map((route) => [route, [[null, [[null, [plainStep(route[0] as number)]]]]]])]])}`;

test("表示文字列から分を読む（Googleの画面と同じ値）", () => {
  assert.equal(parseDurationText("1 時間 1 分"), 61);
  assert.equal(parseDurationText("16 分"), 16);
  assert.equal(parseDurationText("2 時間"), 120);
  assert.equal(parseDurationText("56 秒"), null);
  assert.equal(parseDurationText(""), null);
});

test("車の代表時間は秒の切り上げではなく表示の分を採る（982秒＝「16 分」を17分にしない）", () => {
  const [first] = parseDirectionsResponse(wrap(candidate({ name: "首都高", meters: 9293, distance: "9.3 km", rep: [982, "16 分"] })));
  assert.equal(first.representativeMinutes, 16);
});

test("徒歩の候補を読み、手順は候補にしない", () => {
  const candidates = parseDirectionsResponse(
    plainResponse(
      [2, "六本木通り", [6924, "6.9 km", 0], [3660, "1 時間 1 分"], null, null, null, []],
      [2, "日比谷通り", [6948, "6.9 km", 0], [3700, "1 時間 2 分"], null, null, null, []],
    ),
  );
  assert.deepEqual(candidates.map((item) => [item.name, item.representativeMinutes, item.distanceText]), [
    ["六本木通り", 61, "6.9 km"],
    ["日比谷通り", 62, "6.9 km"],
  ]);
  assert.equal(candidates[0].rangeMinutes, null);
});

test("公共交通は運行間隔ではなく路線名を経路名にする", () => {
  const stamp = (epoch: number) => [epoch, "Asia/Tokyo", "13:10", 32400, epoch];
  const lines = [[5, null, [3, "x.png", null, "地下鉄"]], [5, ["丸ノ内線", 1, "#f22d35", "#ffffff"]], [9], [5, ["銀座線", 1, "#f28e00", "#000000"]]];
  const [first] = parseDirectionsResponse(
    plainResponse([3, "4 分間隔", [7944, "7.9 km", 0], [1200, "20 分", 1200], null, [stamp(1791605400), stamp(1791606600)], null, [], null, null, null, null, null, null, lines]),
  );
  assert.equal(first.name, "丸ノ内線 → 銀座線");
  assert.equal(first.representativeMinutes, 20);
  assert.equal(first.timeZone, "Asia/Tokyo");
});

test("徒歩の経路でもGoogleの代表時間を使い、AIへ聞かない", async () => {
  const result = await resolveGoogleMapsShare("https://maps.app.goo.gl/walk", {
    expand: async (url, accept) => {
      const value = accept("https://www.google.com/maps/dir/A/B/data=!4m2!4m1!3e2");
      return value ? { result: value, url: "https://www.google.com/maps/dir/A/B/data=!4m2!4m1!3e2" } : null;
    },
    directions: async () => ({
      ok: true,
      candidates: parseDirectionsResponse(plainResponse([2, "六本木通り", [6924, "6.9 km", 0], [3660, "1 時間 1 分"], null, null, null, []])),
    }),
    analyze: async () => assert.fail("Googleから取れたときはAIを呼ばない"),
  });
  assert.ok(result.ok);
  assert.equal(result.item.durationMinutes, 61);
  assert.equal(result.item.estimateSource, "GOOGLE_MAPS");
});

test("確認画面で出したAIの目安を渡されたら、AIへ聞き直さずその値を使う", async () => {
  const result = await resolveGoogleMapsShare("https://maps.app.goo.gl/walk", {
    expand: async (url, accept) => {
      const value = accept("https://www.google.com/maps/dir/A/B/data=!4m2!4m1!3e0");
      return value ? { result: value, url: "https://www.google.com/maps/dir/A/B/data=!4m2!4m1!3e0" } : null;
    },
    directions: async () => ({ ok: false, reason: "unreadable" }),
    analyze: async () => assert.fail("引き継いだ目安があるときはAIを呼ばない"),
    knownAiMinutes: 50,
  });
  assert.ok(result.ok);
  assert.equal(result.item.durationMinutes, 50);
  assert.equal(result.item.estimateSource, "AI");
});
