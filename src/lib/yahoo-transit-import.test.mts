import assert from "node:assert/strict";
import test from "node:test";

import { buildYahooTravelImport, retargetYahooWalk } from "@/lib/yahoo-transit-import";

const SAMPLE = `草津(滋賀県) ⇒ 高槻
2026年8月28日(金)
20:58 ⇒ 21:46
------------------------------
所要時間 48分
乗換 0回
------------------------------

■草津(滋賀県)
↓ 20:58〜21:21
■高槻

[Yahoo!乗換案内]
https://transit.yahoo.co.jp/smartphone/app/`;

test("検索日・駅名・時刻を設定タイムゾーンのISOへ直して取り込む", () => {
  const result = buildYahooTravelImport(SAMPLE, "Asia/Tokyo");
  assert.ok(result.ok);
  assert.equal(result.travel.origin, "草津");
  assert.equal(result.travel.destination, "高槻");
  assert.equal(result.travel.mode, "PUBLIC_TRANSIT");
  assert.equal(result.travel.estimateSource, "YAHOO");
  assert.equal(result.travel.departAt, "2026-08-28T11:58:00.000Z");
  assert.equal(result.travel.arriveAt, "2026-08-28T12:46:00.000Z");
  assert.ok(!result.travel.note.includes("Yahoo!乗換案内]"));
});

test("Asia/Tokyoの08:10は前日の23:10Zになる", () => {
  const text = SAMPLE.replace("20:58 ⇒ 21:46", "08:10 ⇒ 09:00");
  const result = buildYahooTravelImport(text, "Asia/Tokyo");
  assert.ok(result.ok);
  assert.equal(result.travel.departAt, "2026-08-27T23:10:00.000Z");
});

test("終電で到着が翌日になる", () => {
  const text = SAMPLE.replace("20:58 ⇒ 21:46", "23:50 ⇒ 00:20");
  const result = buildYahooTravelImport(text, "Asia/Tokyo");
  assert.ok(result.ok);
  assert.equal(result.travel.arriveAt, "2026-08-28T15:20:00.000Z");
});

test("時刻が読めなければ断る", () => {
  const result = buildYahooTravelImport("https://example.com/", "Asia/Tokyo");
  assert.ok(!result.ok);
  assert.equal(result.error, "unreadable");
});

test("検索日が無ければ今日へ置かず断る", () => {
  const result = buildYahooTravelImport(SAMPLE.replace("2026年8月28日(金)\n", ""), "Asia/Tokyo");
  assert.ok(!result.ok);
  assert.equal(result.error, "no_date");
});

test("駅名が読めなければ断る", () => {
  const text = SAMPLE.replace("草津(滋賀県) ⇒ 高槻\n", "").replace("■草津(滋賀県)", "").replace("■高槻", "");
  const result = buildYahooTravelImport(text, "Asia/Tokyo");
  assert.ok(!result.ok);
  assert.equal(result.error, "no_stations");
});

const WITH_WALK = { before: 5, after: 7 };

test("徒歩の設定を電車の発着の前後へ足し、メモに電車の発着を残す（#1463）", () => {
  const text = SAMPLE.replace("↓ 20:58〜21:21", "↓ 20:58〜21:21\n↓ ＪＲ琵琶湖線");
  const result = buildYahooTravelImport(text, "Asia/Tokyo", WITH_WALK);
  assert.ok(result.ok);
  assert.equal(result.travel.departAt, "2026-08-28T11:53:00.000Z");
  assert.equal(result.travel.arriveAt, "2026-08-28T12:53:00.000Z");
  assert.ok(result.travel.note.endsWith("電車の発着 20:58〜21:46 ／ 徒歩 前5分・後7分を含む"));
});

test("徒歩が0・未指定なら時刻もメモも変えない", () => {
  const result = buildYahooTravelImport(SAMPLE, "Asia/Tokyo");
  assert.ok(result.ok);
  assert.equal(result.travel.departAt, "2026-08-28T11:58:00.000Z");
  assert.ok(!result.travel.note.includes("徒歩"));
});

test("始点が徒歩から始まるドアtoドア経路は、その側へ足さない（二重加算の回避）", () => {
  const text = SAMPLE.replace("■草津(滋賀県)\n↓ 20:58〜21:21", "■草津(滋賀県)\n↓ 徒歩\n▼ 草津駅\n↓ 20:58〜21:21");
  const result = buildYahooTravelImport(text, "Asia/Tokyo", WITH_WALK);
  assert.ok(result.ok);
  assert.equal(result.travel.departAt, "2026-08-28T11:58:00.000Z");
  assert.equal(result.travel.arriveAt, "2026-08-28T12:53:00.000Z");
  assert.ok(result.travel.note.endsWith("徒歩 後7分を含む"));
});

test("終点が徒歩で終わる経路は、その側へ足さない", () => {
  const text = SAMPLE.replace("■高槻", "▼ 高槻駅\n↓ 徒歩\n■高槻市役所");
  const result = buildYahooTravelImport(text, "Asia/Tokyo", WITH_WALK);
  assert.ok(result.ok);
  assert.equal(result.travel.departAt, "2026-08-28T11:53:00.000Z");
  assert.equal(result.travel.arriveAt, "2026-08-28T12:46:00.000Z");
});

test("区間を読めない経路（印が2つ未満）は足さない", () => {
  const text = SAMPLE.replace("■草津(滋賀県)\n", "").replace("■高槻\n", "草津(滋賀県) ⇒ 高槻\n");
  const result = buildYahooTravelImport(text, "Asia/Tokyo", WITH_WALK);
  if (result.ok) assert.equal(result.travel.departAt, "2026-08-28T11:58:00.000Z");
});

test("共通の徒歩を足し済みの取り込みを、勤務場所の徒歩へ足し直す（#1471）", () => {
  const built = buildYahooTravelImport(SAMPLE, "Asia/Tokyo", WITH_WALK);
  assert.ok(built.ok);
  const result = retargetYahooWalk(built.travel, { before: 8, after: 12 });
  assert.ok(result);
  assert.equal(result.departAt, "2026-08-28T11:50:00.000Z");
  assert.equal(result.arriveAt, "2026-08-28T12:58:00.000Z");
  assert.ok(result.note.endsWith("電車の発着 20:58〜21:46 ／ 徒歩 前8分・後12分を含む"));
  assert.equal(result.note.match(/電車の発着/g)?.length, 1);
});

test("共通の徒歩が0の取り込みも足し直せ、0にすればメモの行も消える（#1471）", () => {
  const built = buildYahooTravelImport(SAMPLE, "Asia/Tokyo");
  assert.ok(built.ok);
  const added = retargetYahooWalk(built.travel, { before: 3, after: 0 });
  assert.ok(added);
  assert.equal(added.departAt, "2026-08-28T11:55:00.000Z");
  assert.equal(added.arriveAt, "2026-08-28T12:46:00.000Z");
  const removed = retargetYahooWalk({ ...built.travel, ...added }, { before: 0, after: 0 });
  assert.ok(removed);
  assert.equal(removed.departAt, built.travel.departAt);
  assert.equal(removed.note, built.travel.note);
});

test("足し直しでもドアtoドア経路の徒歩側は足さない（#1471）", () => {
  const text = SAMPLE.replace("■草津(滋賀県)\n↓ 20:58〜21:21", "■草津(滋賀県)\n↓ 徒歩\n▼ 草津駅\n↓ 20:58〜21:21");
  const built = buildYahooTravelImport(text, "Asia/Tokyo", WITH_WALK);
  assert.ok(built.ok);
  const result = retargetYahooWalk(built.travel, { before: 9, after: 10 });
  assert.ok(result);
  assert.equal(result.departAt, "2026-08-28T11:58:00.000Z");
  assert.equal(result.arriveAt, "2026-08-28T12:56:00.000Z");
});

test("経路を読めないメモは足し直さない（#1471）", () => {
  const travel = { departAt: "2026-08-28T11:58:00.000Z", arriveAt: "2026-08-28T12:46:00.000Z", note: "メモ" };
  assert.equal(retargetYahooWalk(travel, { before: 5, after: 5 }), null);
});
