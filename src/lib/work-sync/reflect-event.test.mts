import assert from "node:assert/strict";
import test from "node:test";

import { decide, sameSnapshot, type Snapshot } from "@/lib/work-sync/decide";
import { zonedTime } from "@/lib/work-sync/plan";
import { applyEventTime, reflectTarget, zonedDateMinutes } from "@/lib/work-sync/reflect-event";

const TZ = "Asia/Tokyo";
const snapshot: Snapshot = {
  start: "2026-10-05T23:45:00.000Z", // 10/6 08:45 JST
  end: "2026-10-06T08:15:00.000Z", // 10/6 17:15 JST
  title: "勤務（在宅）",
  location: "自宅",
  description: "",
};
const edit = (over: Partial<Parameters<typeof reflectTarget>[2]> = {}) => ({
  start: "2026-10-06T00:00:00.000Z", // 09:00
  end: "2026-10-06T08:30:00.000Z", // 17:30
  title: "勤務（在宅）",
  location: "自宅",
  description: null,
  ...over,
});

test("設定タイムゾーンの日付と分を求める。分単位でない時刻は対象外", () => {
  assert.deepEqual(zonedDateMinutes("2026-10-05T23:45:00.000Z", TZ), { date: "2026-10-06", minutes: 525 });
  assert.equal(zonedDateMinutes("2026-10-05T23:45:30.000Z", TZ), null);
});

test("時刻だけを同じ日の中で直したときだけ反映する", () => {
  assert.deepEqual(reflectTarget(snapshot, "2026-10-06", edit(), TZ), {
    date: "2026-10-06",
    startMinutes: 540,
    endMinutes: 1050,
  });
  assert.equal(reflectTarget(snapshot, "2026-10-06", edit({ title: "別" }), TZ), null);
  assert.equal(reflectTarget(snapshot, "2026-10-06", edit({ location: "渋谷" }), TZ), null);
  assert.equal(reflectTarget(snapshot, "2026-10-06", edit({ description: "メモ" }), TZ), null);
  assert.equal(reflectTarget(snapshot, "2026-10-06", edit({ end: "2026-10-06T15:30:00.000Z" }), TZ), null); // 日をまたぐ
  assert.equal(reflectTarget(snapshot, "2026-10-07", edit(), TZ), null);
});

test("単日は startMinutes/endMinutes、期間・日別指定ありは days へ書く", () => {
  const target = { date: "2026-10-06", startMinutes: 540, endMinutes: 1050 };
  const single = applyEventTime({ workEnabled: true }, { startDate: "2026-10-06", endDate: "2026-10-06" }, target);
  assert.deepEqual(single, { workEnabled: true, startMinutes: 540, endMinutes: 1050 });
  const trip = applyEventTime(null, { startDate: "2026-10-06", endDate: "2026-10-08" }, target);
  assert.deepEqual(trip, { days: { "2026-10-06": { start: 540, end: 1050 } } });
  const withDays = applyEventTime(
    { days: { "2026-10-06": { start: 500, end: 900 } } },
    { startDate: "2026-10-06", endDate: "2026-10-06" },
    target,
  );
  assert.deepEqual(withDays.days, { "2026-10-06": { start: 540, end: 1050 } });
});

test("控えを新しい時刻へ直せば、反映後の予定は手動調整にならず期待値と一致する", () => {
  const target = reflectTarget(snapshot, "2026-10-06", edit(), TZ)!;
  const updated: Snapshot = {
    ...snapshot,
    start: zonedTime("2026-10-06", target.startMinutes, TZ).toISOString(),
    end: zonedTime("2026-10-06", target.endMinutes, TZ).toISOString(),
  };
  const current: Snapshot = { ...snapshot, start: edit().start, end: edit().end };
  assert.ok(sameSnapshot(updated, current));
  assert.equal(decide(updated, { status: "ACTIVE", snapshot: updated }, current), "keep");
  // 控えを直さなければ手動調整へ倒れる（従来の挙動）
  assert.equal(decide(updated, { status: "ACTIVE", snapshot }, current), "markManual");
});

test("ドラッグ（場所・メモを送らない）でも、場所・メモのある勤務予定の時刻を反映する", () => {
  const withMemo: Snapshot = { ...snapshot, description: "メモ" };
  const drag = { start: "2026-10-06T00:00:00.000Z", end: "2026-10-06T08:30:00.000Z", title: "勤務（在宅）" };
  const expected = { date: "2026-10-06", startMinutes: 540, endMinutes: 1050 };
  assert.deepEqual(
    reflectTarget(withMemo, "2026-10-06", { ...drag, location: undefined, description: undefined }, TZ),
    expected,
  );
  // 明示的に消した場合は変更ありとして反映しない
  assert.equal(reflectTarget(withMemo, "2026-10-06", { ...drag, location: null, description: undefined }, TZ), null);
});
