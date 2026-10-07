import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReminderItem } from "@/types/calendar";
import { applyGarbageLeaveTime } from "@/lib/garbage-time";

const TZ = "Asia/Tokyo";
const item = (over: Partial<ReminderItem> = {}): ReminderItem =>
  ({
    kind: "reminder",
    source: "garbage",
    id: "g",
    pageId: "g",
    title: "普通ごみ",
    date: "2026-10-08",
    sourceDate: "2026-10-08",
    hasTime: false,
    category: null,
    memo: null,
    annual: null,
    ...over,
  }) as ReminderItem;

test("出発時刻が無い日は8:30", () => {
  const [r] = applyGarbageLeaveTime([item()], new Map(), TZ);
  assert.equal(r.date, "2026-10-08T08:30:00+09:00");
  assert.equal(r.hasTime, true);
});

test("早い出発は15分前", () => {
  const dep = new Map([["2026-10-08", new Date("2026-10-07T21:30:00Z")]]); // 6:30 JST
  const [r] = applyGarbageLeaveTime([item()], dep, TZ);
  assert.equal(r.date, "2026-10-08T06:15:00+09:00");
});

test("遅い出発でも8:30が上限", () => {
  const dep = new Map([["2026-10-08", new Date("2026-10-08T02:00:00Z")]]); // 11:00 JST
  const [r] = applyGarbageLeaveTime([item()], dep, TZ);
  assert.equal(r.date, "2026-10-08T08:30:00+09:00");
});

test("時刻ありの枠・ゴミ以外は触らない", () => {
  const timed = item({ hasTime: true, date: "2026-10-08T07:00:00+09:00" });
  const other = item({ source: "reminder" });
  const out = applyGarbageLeaveTime([timed, other], new Map(), TZ);
  assert.equal(out[0], timed);
  assert.equal(out[1], other);
});
