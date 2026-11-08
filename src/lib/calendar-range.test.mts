import assert from "node:assert/strict";
import { test } from "node:test";

import { alignToWeekStart, parseDateKey, toDateKey } from "@/lib/calendar-range";

const align = (key: string, weekStartsOn: number) =>
  toDateKey(alignToWeekStart(parseDateKey(key), weekStartsOn));

test("月曜開始: 水曜(2026-11-11)はその週の月曜(11-09)へそろう", () => {
  assert.equal(align("2026-11-11", 1), "2026-11-09");
});

test("日曜開始: 水曜は直前の日曜(11-08)へそろう", () => {
  assert.equal(align("2026-11-11", 0), "2026-11-08");
});

test("土曜開始: 水曜は直前の土曜(11-07)へそろう", () => {
  assert.equal(align("2026-11-11", 6), "2026-11-07");
});

test("開始曜日そのものは動かない（冪等）", () => {
  assert.equal(align("2026-11-09", 1), "2026-11-09");
  assert.equal(align(align("2026-11-13", 1), 1), "2026-11-09");
});

test("日曜は月曜開始だと前の月曜（週の境目）", () => {
  assert.equal(align("2026-11-15", 1), "2026-11-09");
});

test("月をまたぐ", () => {
  assert.equal(align("2026-12-02", 1), "2026-11-30");
});
