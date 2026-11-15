import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPickerLabel,
  joinPickerValue,
  monthGrid,
  parsePickerValue,
  shiftMonth,
  splitTime,
  wrapIndex,
} from "@/lib/date-time-picker";

test("monthGrid は日曜始まりの42マスで、前後の月をはみ出しとして印す", () => {
  const grid = monthGrid(2026, 11);
  assert.equal(grid.length, 42);
  assert.equal(grid[0].key, "2026-11-01"); // 2026-11-01 は日曜
  assert.equal(grid[0].inMonth, true);
  assert.equal(grid[29].key, "2026-11-30");
  assert.equal(grid[30].key, "2026-12-01");
  assert.equal(grid[30].inMonth, false);
});

test("monthGrid は月初が日曜でないとき前月の日で埋める", () => {
  const grid = monthGrid(2026, 12); // 2026-12-01 は火曜
  assert.equal(grid[0].key, "2026-11-29");
  assert.equal(grid[0].inMonth, false);
  assert.equal(grid[2].key, "2026-12-01");
});

test("shiftMonth は年をまたぐ", () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
});

test("parsePickerValue は日付のみ・日時・空を読み分ける", () => {
  assert.deepEqual(parsePickerValue("2026-11-15T09:05"), { date: "2026-11-15", time: "09:05" });
  assert.deepEqual(parsePickerValue("2026-11-15"), { date: "2026-11-15", time: null });
  assert.deepEqual(parsePickerValue(""), { date: "", time: null });
});

test("joinPickerValue: 時刻なしを許す欄は日付だけを返す", () => {
  const opts = { allowNoTime: true, defaultTime: "09:00" };
  assert.equal(joinPickerValue({ date: "2026-11-15", time: null }, opts), "2026-11-15");
  assert.equal(joinPickerValue({ date: "2026-11-15", time: "18:30" }, opts), "2026-11-15T18:30");
});

test("joinPickerValue: 時刻必須の欄は既定時刻を補い、常に日時を返す", () => {
  const opts = { allowNoTime: false, defaultTime: "09:00" };
  assert.equal(joinPickerValue({ date: "2026-11-15", time: null }, opts), "2026-11-15T09:00");
  assert.equal(joinPickerValue({ date: "", time: "10:00" }, opts), "");
});

test("splitTime と wrapIndex は時0〜23・分0〜59の循環に使える", () => {
  assert.deepEqual(splitTime("23:59"), { hour: 23, minute: 59 });
  assert.equal(wrapIndex(24, 24), 0);
  assert.equal(wrapIndex(-1, 24), 23);
  assert.equal(wrapIndex(-1, 60), 59);
});

test("formatPickerLabel は時刻なしを ー:ー と出す", () => {
  assert.equal(formatPickerLabel({ date: "2026-11-15", time: "09:00" }), "2026年11月15日（日） 09:00");
  assert.equal(formatPickerLabel({ date: "2026-11-15", time: null }), "2026年11月15日（日） ー:ー");
});
