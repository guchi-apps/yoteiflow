import assert from "node:assert/strict";
import test from "node:test";

import {
  initialViewFromSetting,
  isInitialCalendarView,
  resolveCalendarView,
  resolveInitialView,
} from "@/lib/calendar-initial-view";

test("未設定・選べない値は月表示", () => {
  assert.equal(initialViewFromSetting(undefined), "month");
  assert.equal(initialViewFromSetting(null), "month");
  assert.equal(initialViewFromSetting("bogus"), "month");
  assert.equal(initialViewFromSetting("MONTH"), "month");
  assert.equal(initialViewFromSetting("DAY_1"), "day1");
});

test("端末のCookieが従来のDB値より優先、無い・不正ならDB値", () => {
  assert.equal(resolveInitialView("day3", "DAY_7"), "day3");
  assert.equal(resolveInitialView("day7", undefined), "day7");
  assert.equal(resolveInitialView(undefined, "DAY_1"), "day1");
  assert.equal(resolveInitialView("bogus", "DAY_1"), "day1");
  assert.equal(resolveInitialView(undefined, undefined), "month");
});

test("URLのviewは常に優先、無ければCookie、DB値、月の順", () => {
  assert.equal(resolveCalendarView("day3", "day7", "DAY_1"), "day3");
  assert.equal(resolveCalendarView("month", "day7", "DAY_1"), "month");
  assert.equal(resolveCalendarView(undefined, "day7", "DAY_1"), "day7");
  assert.equal(resolveCalendarView(undefined, undefined, "DAY_1"), "day1");
  assert.equal(resolveCalendarView(undefined, undefined, undefined), "month");
  assert.equal(resolveCalendarView("bogus", "day7", "DAY_1"), "month");
});

test("4つの表示形式を判定できる", () => {
  for (const view of ["month", "day1", "day3", "day7"] as const) {
    assert.equal(isInitialCalendarView(view), true);
  }
  assert.equal(isInitialCalendarView("toString"), false);
  assert.equal(isInitialCalendarView(undefined), false);
});
