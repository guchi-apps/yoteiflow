import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveEnd,
  durationLabel,
  endDayBadge,
  followEnd,
  initRange,
  isMultiDay,
  pickDay,
  rangeValid,
  setEndTime,
  setStartTime,
  toggleRange,
} from "@/lib/date-range-picker";

test("開始を21:00→23:00にすると、2時間を保って終了は翌日1:00になる", () => {
  const state = initRange("2026-11-15T21:00", "2026-11-15T23:00", false);
  const next = setStartTime(state, "23:00", true);
  assert.equal(next.end, "2026-11-16T01:00");
  assert.equal(isMultiDay(next), true);
  assert.equal(endDayBadge(next.start, next.end), "翌日");
  assert.equal(durationLabel(next.start, next.end, false), "2時間");
});

test("活動記録（follow=false）は開始を変えても終了を動かさない", () => {
  const state = initRange("2026-11-15T21:00", "2026-11-15T23:00", false);
  assert.equal(setStartTime(state, "22:00", false).end, "2026-11-15T23:00");
});

test("単日で終了時刻を開始以前にすると翌日と解釈する", () => {
  const state = initRange("2026-11-15T22:00", "2026-11-15T23:00", false);
  assert.equal(setEndTime(state, "02:00").end, "2026-11-16T02:00");
  assert.equal(setEndTime(state, "23:30").end, "2026-11-15T23:30");
  assert.equal(deriveEnd("2026-11-15T22:00", "22:00"), "2026-11-16T22:00");
});

test("単日では押した日が開始日かつ終了日になる（何回押しても）", () => {
  let state = initRange("2026-11-15", "2026-11-15", true);
  state = pickDay(state, "2026-11-20");
  state = pickDay(state, "2026-11-22");
  assert.deepEqual([state.start, state.end], ["2026-11-22", "2026-11-22"]);
});

test("単日で日をまたぐ時刻ありの予定は、長さを保って押した日へ移る", () => {
  const state = pickDay(initRange("2026-11-15T23:00", "2026-11-16T01:00", false), "2026-11-20");
  assert.deepEqual([state.start, state.end], ["2026-11-20T23:00", "2026-11-21T01:00"]);
});

test("範囲選択は1回目が開始日、2回目が終了日。開始日より前を押すと開始日を付け替える", () => {
  let state = toggleRange(initRange("2026-11-15", "2026-11-15", true));
  assert.equal(state.rangeMode, true);
  state = pickDay(state, "2026-11-20");
  assert.equal(state.pending, true);
  assert.equal(rangeValid(state), false);
  state = pickDay(state, "2026-11-18");
  assert.equal(state.start, "2026-11-18");
  assert.equal(state.pending, true);
  state = pickDay(state, "2026-11-23");
  assert.deepEqual([state.start, state.end, state.pending], ["2026-11-18", "2026-11-23", false]);
  assert.equal(durationLabel(state.start, state.end, true), "6日間");
  // 決まったあとに押すと選び直し
  state = pickDay(state, "2026-11-25");
  assert.deepEqual([state.start, state.pending], ["2026-11-25", true]);
});

test("終日は同日終了を許す", () => {
  assert.equal(rangeValid(initRange("2026-11-15", "2026-11-15", true)), true);
  assert.equal(rangeValid(initRange("2026-11-15", "2026-11-14", true)), false);
});

test("範囲を解除すると単日に戻る", () => {
  const multi = initRange("2026-11-20", "2026-11-23", true);
  assert.equal(multi.rangeMode, true);
  const single = toggleRange(multi);
  assert.deepEqual([single.end, single.rangeMode], ["2026-11-20", false]);
  const timed = toggleRange(initRange("2026-11-20T10:00", "2026-11-23T12:00", false));
  assert.equal(timed.end, "2026-11-20T12:00");
});

test("範囲選択の時刻ありで、同じ日・終了が開始以前なら開始の1時間後にする", () => {
  let state = toggleRange(initRange("2026-11-15T10:00", "2026-11-15T09:00", false));
  state = pickDay(state, "2026-11-15");
  state = pickDay(state, "2026-11-15");
  assert.equal(state.end, "2026-11-15T11:00");
});

test("24時間を超える時刻ありの予定・複数日の終日予定は範囲選択から始める", () => {
  assert.equal(initRange("2026-11-15T23:00", "2026-11-16T01:00", false).rangeMode, false);
  assert.equal(initRange("2026-11-15T10:00", "2026-11-17T01:00", false).rangeMode, true);
  assert.equal(followEnd("2026-11-15", "2026-11-17", "2026-11-16", true), "2026-11-18");
  assert.equal(endDayBadge("2026-11-15T10:00", "2026-11-17T01:00"), "+2日");
  assert.equal(durationLabel("2026-11-15T10:00", "2026-11-16T11:30", false), "1日1時間30分");
});
