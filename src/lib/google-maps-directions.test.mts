import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateMinutes,
  extractDirectionsUrl,
  fetchGoogleMapsDirections,
  parseDirectionsResponse,
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

test("出発指定14:08＋範囲の上限80分＝15:28（9時間ずれない・14:58や23:08にならない）", () => {
  const [first] = parseDirectionsResponse(departResponse);
  const times = scheduleCandidate(first, departSchedule, TZ);
  assert.equal(times.startAt, "2026-10-07T05:08:00.000Z"); // 14:08 JST
  assert.equal(times.endAt, "2026-10-07T06:28:00.000Z"); // 15:28 JST
  assert.equal(times.minutes, 80);
});

test("到着指定12:30−150分＝10:00（Googleが返す出発時刻を優先）", () => {
  const candidates = parseDirectionsResponse(arriveResponse);
  const kyoshi = candidates.find((item) => item.name === "京滋バイパス")!;
  const times = scheduleCandidate(kyoshi, arriveSchedule, TZ);
  assert.equal(times.startAt, "2026-10-09T01:00:00.000Z"); // 10:00 JST
  assert.equal(times.endAt, "2026-10-09T03:30:00.000Z"); // 12:30 JST
  assert.equal(times.minutes, 150);
});

test("反対側の時刻が無ければ、予測の上限から逆算・加算する（日付またぎ含む）", () => {
  const base: DirectionsCandidate = {
    name: "", distanceMeters: null, distanceText: null, rangeMinutes: { min: 30, max: 90 }, rangeText: null,
    representativeMinutes: 60, representativeText: null, otherEndEpoch: null, timeZone: null,
  };
  // 23:30出発＋90分＝翌1:00
  const forward = scheduleCandidate(base, { basis: "depart", local: "2026-10-07T23:30" }, TZ);
  assert.equal(forward.endAt, "2026-10-07T16:00:00.000Z");
  // 0:30到着−90分＝前日23:00
  const backward = scheduleCandidate(base, { basis: "arrive", local: "2026-10-08T00:30" }, TZ);
  assert.equal(backward.startAt, "2026-10-07T14:00:00.000Z");
});

test("範囲が無く単一の時間だけなら、その時間を使う。日時が無ければ時刻は決めず所要時間だけ返す", () => {
  const single: DirectionsCandidate = {
    name: "", distanceMeters: null, distanceText: null, rangeMinutes: null, rangeText: null,
    representativeMinutes: 42, representativeText: null, otherEndEpoch: null, timeZone: null,
  };
  assert.equal(candidateMinutes(single), 42);
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

test("共有（出発指定）: 候補が違っても結果が同じなら確定し、14:08〜15:28・GOOGLE_MAPS・詳細を保持する", async () => {
  const result = await share(dirUrl(0, 1791382080), departResponse);
  assert.ok(result.ok);
  const { item } = result;
  assert.equal(item.startAt, "2026-10-07T05:08:00.000Z");
  assert.equal(item.endAt, "2026-10-07T06:28:00.000Z");
  assert.equal(item.durationMinutes, 80);
  assert.equal(item.estimateSource, "GOOGLE_MAPS");
  assert.equal(item.registrable, true);
  assert.equal(item.candidates, null);
  assert.match(item.detail ?? "", /35 分～1 時間 20 分/);
  assert.match(item.detail ?? "", /18\.5 km/);
  assert.match(item.detail ?? "", /^https:\/\/www\.google\.com\/maps\/dir\//);
});

test("共有（到着指定）: 候補が割れるときは先頭を選ばず候補を返し、候補ごとの時間が対応する", async () => {
  const result = await share(dirUrl(1, 1791549000), arriveResponse);
  assert.ok(result.ok);
  const { item } = result;
  assert.equal(item.registrable, false);
  assert.equal(item.durationMinutes, null);
  assert.equal(item.startAt, null);
  assert.equal(item.endAt, "2026-10-09T03:30:00.000Z"); // 固定側（到着12:30）だけ
  assert.equal(item.candidates?.length, 3);
  const byName = Object.fromEntries((item.candidates ?? []).map((candidate) => [candidate.name, candidate]));
  assert.equal(byName["国道422号"].startAt, "2026-10-09T01:20:00.000Z"); // 10:20
  assert.equal(byName["国道422号"].minutes, 130);
  assert.equal(byName["国道163号"].startAt, "2026-10-09T00:50:00.000Z"); // 9:50
  assert.equal(byName["京滋バイパス"].startAt, "2026-10-09T01:00:00.000Z"); // 10:00
  assert.equal(byName["京滋バイパス"].minutes, 150);
  assert.match(item.notice ?? "", /特定できません/);
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
