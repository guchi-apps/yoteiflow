import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOfflineWeekPlan,
  offlineWeekLabel,
  parseOfflineWeekMeta,
} from "@/lib/offline-week";

test("1週間が同じ月に収まるときは、勤務はその月だけ保存する", () => {
  const plan = buildOfflineWeekPlan("2026-11-02", "Asia/Tokyo");
  assert.equal(plan.calendar, "/api/calendar?view=day7&date=2026-11-02");
  assert.deepEqual(
    plan.data.filter((path) => path.startsWith("/api/work/month")),
    ["/api/work/month?month=2026-11"],
  );
});

test("1週間が月をまたぐときは、翌月の勤務も保存する", () => {
  const plan = buildOfflineWeekPlan("2026-11-28", "Asia/Tokyo");
  assert.deepEqual(
    plan.data.filter((path) => path.startsWith("/api/work/month")),
    ["/api/work/month?month=2026-11", "/api/work/month?month=2026-12"],
  );
});

test("1週間が年をまたいでも翌月を求められる", () => {
  const plan = buildOfflineWeekPlan("2026-12-30", "Asia/Tokyo");
  assert.ok(plan.data.includes("/api/work/month?month=2027-01"));
});

test("控えは形が違えば無かったことにする", () => {
  assert.equal(parseOfflineWeekMeta(null), null);
  assert.equal(parseOfflineWeekMeta({ startKey: "x", timeZone: "Asia/Tokyo", savedAt: 1 }), null);
  assert.equal(parseOfflineWeekMeta({ startKey: "2026-11-02", timeZone: "Asia/Tokyo" }), null);
  assert.deepEqual(
    parseOfflineWeekMeta({ startKey: "2026-11-02", timeZone: "Asia/Tokyo", savedAt: 1 }),
    { startKey: "2026-11-02", timeZone: "Asia/Tokyo", savedAt: 1 },
  );
});

test("帯の文は保存した範囲と時点を設定のタイムゾーンで示す", () => {
  const label = offlineWeekLabel({
    startKey: "2026-11-28",
    timeZone: "Asia/Tokyo",
    savedAt: Date.UTC(2026, 10, 28, 1, 30),
  });
  assert.equal(label, "11/28〜12/4の予定を11/28 10:30に保存しました。");
});
