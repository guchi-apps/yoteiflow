import assert from "node:assert/strict";
import test from "node:test";

import {
  initialViewFromSetting,
  resolveCalendarView,
  settingFromInitialView,
} from "@/lib/calendar-initial-view";

test("未設定・選べない値は月表示", () => {
  assert.equal(initialViewFromSetting(undefined), "month");
  assert.equal(initialViewFromSetting(null), "month");
  assert.equal(initialViewFromSetting("DAY_7"), "month");
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
