import assert from "node:assert/strict";
import test from "node:test";

import {
  resetPreAppliedOnKindChange,
  resolveSegmentsUpdate,
  workKindFlag,
} from "@/services/notion/work-logs";
import type { WorkRecordItem } from "@/types/work";

function record(overrides: Partial<WorkRecordItem>): WorkRecordItem {
  return {
    id: "r1",
    title: "出張",
    startDate: "2026-04-10",
    endDate: "2026-04-10",
    place: null,
    annualLeave: null,
    businessTrip: true,
    companyHoliday: false,
    preApplied: true,
    postRegistered: false,
    memo: null,
    segments: [],
    segmentsText: null,
    segmentsInvalid: false,
    url: null,
    ...overrides,
  };
}

test("workKindFlag: 出張はtrip、年休はleave、どちらでもなければnull", () => {
  assert.equal(workKindFlag(true, null), "trip");
  assert.equal(workKindFlag(false, "全休"), "leave");
  assert.equal(workKindFlag(false, null), null);
});

test("workKindFlag: 両方立っていれば年休を優先する（kindOf・workTodosと同じ順序）", () => {
  assert.equal(workKindFlag(true, "全休"), "leave");
});

test("resetPreAppliedOnKindChange: 出張から年休へ切り替えるとpreAppliedをfalseへ強制する", () => {
  const previous = record({ businessTrip: true, annualLeave: null, preApplied: true });
  const input = { annualLeave: "全休", businessTrip: false, preApplied: true };

  const result = resetPreAppliedOnKindChange(previous, input);

  assert.equal(result.preApplied, false);
});

test("resetPreAppliedOnKindChange: 年休から出張へ切り替えるとpreAppliedをfalseへ強制する", () => {
  const previous = record({ businessTrip: false, annualLeave: "全休", preApplied: true });
  const input = { annualLeave: null, businessTrip: true, preApplied: true };

  const result = resetPreAppliedOnKindChange(previous, input);

  assert.equal(result.preApplied, false);
});

test("resetPreAppliedOnKindChange: businessTripを送らずannualLeaveだけを送ってもfalseへ強制する（計画レビューG1-1）", () => {
  // 変更前は出張（businessTrip: true）。MCP・APIから直接annualLeaveだけを送り、
  // businessTripには触れない要求を想定する。重ねた結果はbusinessTrip: true（変更前のまま）
  // とannualLeaveの両方が立つが、年休を優先する判定（workKindFlag）でleaveへの変更を検知する。
  const previous = record({ businessTrip: true, annualLeave: null, preApplied: true });
  const input = { annualLeave: "全休" };

  const result = resetPreAppliedOnKindChange(previous, input);

  assert.equal(result.preApplied, false);
});

test("resetPreAppliedOnKindChange: preAppliedを送らなくてもfalseへ強制する", () => {
  const previous = record({ businessTrip: true, annualLeave: null, preApplied: true });
  const input = { annualLeave: "全休", businessTrip: false };

  const result = resetPreAppliedOnKindChange(previous, input);

  assert.equal(result.preApplied, false);
});

test("resetPreAppliedOnKindChange: 出張のまま日付だけ動かしてもpreAppliedへは触らない", () => {
  const previous = record({ businessTrip: true, annualLeave: null, preApplied: true });
  const input = { startDate: "2026-04-11" };

  const result = resetPreAppliedOnKindChange(previous, input);

  assert.equal(result.preApplied, undefined);
  assert.deepEqual(result, input);
});

test("resetPreAppliedOnKindChange: 勤務から出張への初回設定でも、事前申請への再チェックはfalseへ戻す（計画レビューG1-2）", () => {
  // 勤務にはpreAppliedの概念が無いため保存時に送られず、Notion側に以前（出張だった頃）の
  // preAppliedがtrueのまま残っていることがある。勤務を経由しただけで検知を回避できないよう、
  // 変更前の種類がnull（勤務・休み）でも、変更後が出張・年休なら常に強制する。
  const previous = record({ businessTrip: false, annualLeave: null, preApplied: true });
  const input = { businessTrip: true, preApplied: true };

  const result = resetPreAppliedOnKindChange(previous, input);

  assert.equal(result.preApplied, false);
});

test("resetPreAppliedOnKindChange: 出張→勤務→出張と経由しても、最初の出張時点のpreAppliedは引き継がれない", () => {
  // 出張(preApplied:true) → 勤務（保存時にpreAppliedは送られず、Notion側はtrueのまま）
  // → 出張、という2回目の更新を想定。1回目の更新結果（勤務・preApplied:trueのまま）を
  // 「変更前」として渡し、出張へ戻す2回目の更新でもfalseへ強制されることを確かめる。
  const afterFirstUpdate = record({ businessTrip: false, annualLeave: null, preApplied: true });
  const secondInput = { businessTrip: true };

  const result = resetPreAppliedOnKindChange(afterFirstUpdate, secondInput);

  assert.equal(result.preApplied, false);
});

test("resetPreAppliedOnKindChange: 出張から勤務へ外すだけでは強制しない", () => {
  const previous = record({ businessTrip: true, annualLeave: null, preApplied: true });
  const input = { businessTrip: false };

  const result = resetPreAppliedOnKindChange(previous, input);

  assert.equal(result.preApplied, undefined);
});

test("resetPreAppliedOnKindChange: 変更前の記録が無い（新規作成）ときは何もしない", () => {
  const input = { annualLeave: "全休", preApplied: true };

  const result = resetPreAppliedOnKindChange(null, input);

  assert.equal(result, input);
});

test("resetPreAppliedOnKindChange: 年休の区分だけを変えても出張へは変わらないので強制しない", () => {
  const previous = record({ businessTrip: false, annualLeave: "全休", preApplied: true });
  const input = { annualLeave: "午前半休" };

  const result = resetPreAppliedOnKindChange(previous, input);

  assert.equal(result.preApplied, undefined);
});

test("resetPreAppliedOnKindChange: 出張のまま保存し直しても強制しない（変更前後が同じtrip）", () => {
  const previous = record({ businessTrip: true, annualLeave: null, preApplied: true });
  const input = { businessTrip: true, postRegistered: true };

  const result = resetPreAppliedOnKindChange(previous, input);

  assert.equal(result.preApplied, undefined);
});

// --- 時間帯の内訳の整合（issue #1155・計画レビュー指摘1） ---

const morningHome = { date: null, start: 525, end: 720, place: "在宅", trip: false, destination: null };
const afternoonTrip = { date: null, start: 780, end: 1035, place: null, trip: true, destination: null };

test("内訳を送らない変更でも、記録と食い違えば内訳をまるごと空にする", () => {
  const trip = record({ businessTrip: true, segments: [morningHome, afternoonTrip] });
  // 出張→勤務（今日の勤務場所の1押しなど）: 出張の区切りが残るため消す。
  assert.deepEqual(resolveSegmentsUpdate(trip, { businessTrip: false, place: "出社" }), {
    segments: [],
    cleared: true,
    error: null,
  });
  // 年休に変えた。
  assert.equal(resolveSegmentsUpdate(trip, { annualLeave: "全休" }).cleared, true);
  // 単日→期間: 区切りに日付が無く、どの日のものか決まらない。
  assert.equal(
    resolveSegmentsUpdate(trip, { startDate: "2026-10-05", endDate: "2026-10-06" }).cleared,
    true,
  );
  // 単日のまま日付だけ動かすのは食い違わない。手続きの切り替えも触らない。
  assert.deepEqual(resolveSegmentsUpdate(trip, { startDate: "2026-10-12" }), {
    cleared: false,
    error: null,
  });
  assert.deepEqual(resolveSegmentsUpdate(trip, { preApplied: true }), { cleared: false, error: null });
});

test("送られた内訳が食い違っていれば断り、空配列は列を空にする", () => {
  const work = record({ businessTrip: false });
  assert.match(resolveSegmentsUpdate(work, { segments: [afternoonTrip] }).error!, /出張の記録だけ/);
  assert.deepEqual(resolveSegmentsUpdate(work, { segments: [] }), {
    segments: [],
    cleared: false,
    error: null,
  });
});

test("読めなかった手書きの内訳は、年休・休みに変わったときだけ片付ける", () => {
  const invalid = record({ businessTrip: false, segmentsInvalid: true, segmentsText: "午後は出張" });
  assert.equal(resolveSegmentsUpdate(invalid, { place: "出社" }).cleared, false);
  assert.equal(resolveSegmentsUpdate(invalid, { companyHoliday: true }).cleared, true);
});
