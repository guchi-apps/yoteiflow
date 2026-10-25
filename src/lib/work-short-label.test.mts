import assert from "node:assert/strict";
import test from "node:test";

import { isSingleCharacter, workShortLabel } from "@/lib/work-short-label";
import type { WorkRecordItem } from "@/types/work";

function record(overrides: Partial<WorkRecordItem>): WorkRecordItem {
  return {
    id: "1",
    title: "在宅",
    startDate: "2026-10-26",
    endDate: "2026-10-26",
    place: "在宅",
    annualLeave: null,
    businessTrip: false,
    companyHoliday: false,
    ...overrides,
  } as WorkRecordItem;
}

test("設定した1文字を優先し、未設定は先頭の1文字", () => {
  assert.equal(workShortLabel(record({ place: "門真" }), { 門真: "ド" }), "ド");
  assert.equal(workShortLabel(record({ place: "栗東" }), {}), "栗");
});

test("出張は行き先の先頭1文字", () => {
  assert.equal(workShortLabel(record({ businessTrip: true, title: "大阪", place: null }), {}), "大");
});

test("全休と休みは「休」、半休は残りの勤務場所の1文字", () => {
  assert.equal(workShortLabel(record({ annualLeave: "全休" }), {}), "休");
  assert.equal(workShortLabel(record({ companyHoliday: true }), {}), "休");
  assert.equal(workShortLabel(record({ annualLeave: "午前半休", place: "門真" }), {}), "門");
});

test("1文字の判定は絵文字も1文字と数える", () => {
  assert.equal(isSingleCharacter("門"), true);
  assert.equal(isSingleCharacter("🏠"), true);
  assert.equal(isSingleCharacter("門真"), false);
  assert.equal(isSingleCharacter(""), false);
});
