import assert from "node:assert/strict";
import test from "node:test";
import { candidateFormTimes } from "@/lib/share-import/candidate-times";

const toLocal = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
const current = { departAt: "2026-10-10T09:00", arriveAt: "2026-10-10T09:30" };
const a = { startAt: "2026-10-10T01:40:00.000Z", endAt: "2026-10-10T03:30:00.000Z", minutes: 110 };
const noMinutes = { startAt: null, endAt: "2026-10-10T03:30:00.000Z", minutes: null };

test("到着固定: 固定側と選んだ候補の代表時間だけを入力欄へ入れる", () => {
  assert.deepEqual(candidateFormTimes(a, current, toLocal), { departAt: "2026-10-10T10:40", arriveAt: "2026-10-10T12:30" });
});

test("代表時間なしの候補は反対側を空にし、直前の候補の長さを引き継がない（A→B→A）", () => {
  const afterA = candidateFormTimes(a, current, toLocal);
  const afterB = candidateFormTimes(noMinutes, afterA, toLocal);
  assert.deepEqual(afterB, { departAt: "", arriveAt: "2026-10-10T12:30" });
  assert.deepEqual(candidateFormTimes(a, afterB, toLocal), afterA);
});

test("日時指定が無い共有: 出発は保持し、代表時間があるときだけ到着を求める", () => {
  const none = { startAt: null, endAt: null, minutes: 120 };
  assert.deepEqual(candidateFormTimes(none, current, toLocal), { departAt: "2026-10-10T09:00", arriveAt: "2026-10-10T11:00" });
  assert.deepEqual(candidateFormTimes({ ...none, minutes: null }, current, toLocal), { departAt: "2026-10-10T09:00", arriveAt: "" });
});

test("予定に紐づく移動は予定の日を動かさない", () => {
  const linked = { departAt: "2026-11-01T09:00", arriveAt: "2026-11-01T10:00" };
  assert.deepEqual(candidateFormTimes(a, linked, toLocal, linked), { departAt: "2026-11-01T10:40", arriveAt: "2026-11-01T12:30" });
});
