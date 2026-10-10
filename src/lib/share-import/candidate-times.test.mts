import assert from "node:assert/strict";
import test from "node:test";
import { candidateFormTimes, deriveOtherSide, nowLocalInput } from "@/lib/share-import/candidate-times";

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

const bare = { startAt: null, endAt: null, minutes: 30 };

test("日時なし: 現在10:00・代表30分なら10:00〜10:30（現在は閲覧日に依らず利用者のタイムゾーン）", () => {
  const now = nowLocalInput(new Date("2026-10-10T01:00:00.000Z"), toLocal);
  assert.equal(now, "2026-10-10T10:00");
  assert.deepEqual(candidateFormTimes(bare, { departAt: now, arriveAt: "" }, toLocal), { departAt: "2026-10-10T10:00", arriveAt: "2026-10-10T10:30" });
});

test("出発11:00なら11:00〜11:30、到着12:00なら11:30〜12:00で、候補を変えても基準側を保つ", () => {
  assert.equal(deriveOtherSide("depart", "2026-10-10T11:00", 30), "2026-10-10T11:30");
  assert.equal(deriveOtherSide("arrive", "2026-10-10T12:00", 30), "2026-10-10T11:30");
  const arrive = { departAt: "2026-10-10T11:30", arriveAt: "2026-10-10T12:00" };
  assert.deepEqual(candidateFormTimes({ ...bare, minutes: 45 }, arrive, toLocal, null, "arrive"), { departAt: "2026-10-10T11:15", arriveAt: "2026-10-10T12:00" });
  assert.deepEqual(candidateFormTimes({ ...bare, minutes: 45 }, { departAt: "2026-10-10T11:00", arriveAt: "2026-10-10T11:30" }, toLocal), { departAt: "2026-10-10T11:00", arriveAt: "2026-10-10T11:45" });
});

test("所要時間が未取得なら反対側は空（0分扱いにしない）。出発初期値・到着基準の出発は保持する", () => {
  assert.equal(deriveOtherSide("depart", "2026-10-10T11:00", null), "");
  assert.deepEqual(candidateFormTimes({ ...bare, minutes: null }, { departAt: "2026-10-10T10:00", arriveAt: "2026-10-10T10:30" }, toLocal), { departAt: "2026-10-10T10:00", arriveAt: "" });
  assert.deepEqual(candidateFormTimes({ ...bare, minutes: null }, { departAt: "2026-10-10T10:00", arriveAt: "2026-10-10T12:00" }, toLocal, null, "arrive"), { departAt: "2026-10-10T10:00", arriveAt: "2026-10-10T12:00" });
});

test("日付またぎ", () => {
  assert.equal(deriveOtherSide("depart", "2026-10-10T23:50", 30), "2026-10-11T00:20");
  assert.equal(deriveOtherSide("arrive", "2026-10-11T00:10", 30), "2026-10-10T23:40");
});
