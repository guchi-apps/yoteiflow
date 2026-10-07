import assert from "node:assert/strict";
import test from "node:test";

import {
  initialViewFromSetting,
  isInitialCalendarView,
  resolveCalendarView,
  settingFromInitialView,
} from "@/lib/calendar-initial-view";

test("未設定・選べない値は月表示", () => {
  assert.equal(initialViewFromSetting(undefined), "month");
  assert.equal(initialViewFromSetting(null), "month");
  assert.equal(initialViewFromSetting("bogus"), "month");
  assert.equal(initialViewFromSetting("MONTH"), "month");
});

test("日表示の設定は1日表示", () => {
  assert.equal(initialViewFromSetting("DAY_1"), "day1");
  assert.equal(settingFromInitialView("day1"), "DAY_1");
  assert.equal(settingFromInitialView("month"), "MONTH");
});

test("URLのviewは設定より優先、無ければ設定", () => {
  assert.equal(resolveCalendarView("day3", "DAY_1"), "day3");
  assert.equal(resolveCalendarView("month", "DAY_1"), "month");
  assert.equal(resolveCalendarView(undefined, "DAY_1"), "day1");
  assert.equal(resolveCalendarView(undefined, undefined), "month");
  assert.equal(resolveCalendarView("bogus", "DAY_1"), "month");
});

test("4つの表示形式がDBの値と往復できる", () => {
  for (const view of ["month", "day1", "day3", "day7"] as const) {
    assert.equal(isInitialCalendarView(view), true);
    assert.equal(initialViewFromSetting(settingFromInitialView(view)), view);
  }
  assert.equal(settingFromInitialView("day3"), "DAY_3");
  assert.equal(settingFromInitialView("day7"), "DAY_7");
  assert.equal(isInitialCalendarView("toString"), false);
  assert.equal(isInitialCalendarView(undefined), false);
});

test("週表示が保存されていてもURLのviewが優先", () => {
  assert.equal(resolveCalendarView("day3", "DAY_7"), "day3");
  assert.equal(resolveCalendarView("month", "DAY_7"), "month");
  assert.equal(resolveCalendarView(undefined, "DAY_7"), "day7");
});
