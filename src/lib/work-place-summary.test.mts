import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizePlace } from "@/lib/work-place-summary";

const base = {
  isTrip: false,
  remote: false,
  workEnabled: true,
  startMinutes: null,
  endMinutes: null,
  outMinutes: null,
  backMinutes: null,
};

test("既定値が無い場所は共通の勤務時間だけを出す", () => {
  assert.deepEqual(summarizePlace(base), { badges: [], details: ["勤務 共通の時間"] });
});

test("勤務時間と往路復路を出す", () => {
  const summary = summarizePlace({ ...base, startMinutes: 540, endMinutes: 1065, outMinutes: 40, backMinutes: 40 });
  assert.deepEqual(summary.details, ["勤務 09:00–17:45", "往路 40分 / 復路 40分"]);
});

test("片方だけの所要時間は未設定と添える", () => {
  const summary = summarizePlace({ ...base, outMinutes: 75 });
  assert.deepEqual(summary.details[1], "往路 75分 / 復路 未設定");
});

test("在宅は往路復路を出さず、印を付ける", () => {
  const summary = summarizePlace({ ...base, remote: true, outMinutes: 40, backMinutes: 40 });
  assert.deepEqual(summary, { badges: ["在宅扱い"], details: ["勤務 共通の時間"] });
});

test("出張扱いの印と、勤務を反映しない場所", () => {
  const summary = summarizePlace({ ...base, isTrip: true, workEnabled: false });
  assert.deepEqual(summary, { badges: ["出張扱い"], details: ["勤務時間は反映しない"] });
});
