import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkOverride } from "@/lib/work-sync/override";

test("正しい指定はそのまま通る", () => {
  const result = parseWorkOverride({
    workEnabled: true,
    startMinutes: 540,
    endMinutes: 1080,
    outbound: { enabled: true, minutes: 60 },
    return: { enabled: false, minutes: 999999 },
  });
  assert.ok(result.ok);
  // 反映OFFの項目の時間は問わない。
  assert.deepEqual(result.override.return, { enabled: false, minutes: null });
});

test("反映ONの所要時間が不正なら項目を示して断る", () => {
  const result = parseWorkOverride({ outbound: { enabled: true, minutes: 0 } });
  assert.ok(!result.ok && result.message.includes("往路"));
});

test("終了が開始以前・時刻が範囲外は断る", () => {
  assert.equal(parseWorkOverride({ startMinutes: 600, endMinutes: 600 }).ok, false);
  assert.equal(parseWorkOverride({ startMinutes: 2000 }).ok, false);
  assert.equal(parseWorkOverride("x").ok, false);
});

test("日ごとの勤務時間を検証する（issue #1342）", () => {
  const ok = parseWorkOverride({ days: { "2026-10-27": { start: 600, end: 1020 } } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && ok.override.days, { "2026-10-27": { start: 600, end: 1020 } });
  assert.equal(parseWorkOverride({ days: { "10/27": { start: 600, end: 1020 } } }).ok, false);
  assert.equal(parseWorkOverride({ days: { "2026-10-27": { start: 700, end: 700 } } }).ok, false);
  assert.equal(parseWorkOverride({ days: [] }).ok, false);
});

test("電車の指定（trainId）は通り、反映オフの項目では持たない（issue #1347）", () => {
  const ok = parseWorkOverride({ outbound: { enabled: true, trainId: "abc" }, return: { enabled: false, trainId: "def" } });
  assert.ok(ok.ok);
  assert.equal(ok.override.outbound?.trainId, "abc");
  assert.equal(ok.override.return?.trainId, undefined);
});

test("電車の指定が文字列でない・空は断る", () => {
  assert.equal(parseWorkOverride({ outbound: { trainId: 1 } }).ok, false);
  assert.equal(parseWorkOverride({ outbound: { trainId: "" } }).ok, false);
  assert.ok(parseWorkOverride({ outbound: { trainId: null } }).ok);
});

test("移動方法の指定（issue #1447）は通り、不正な値と反映オフの項目では持たない", () => {
  const ok = parseWorkOverride({ outbound: { enabled: true, minutes: 35, mode: "CAR" }, return: { enabled: false, mode: "WALK" } });
  assert.ok(ok.ok);
  assert.equal(ok.override.outbound?.mode, "CAR");
  assert.equal(ok.override.return?.mode, undefined);
  assert.equal(parseWorkOverride({ outbound: { mode: "BOAT" } }).ok, false);
});
