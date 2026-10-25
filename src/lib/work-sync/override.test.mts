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
