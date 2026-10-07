import assert from "node:assert/strict";
import test from "node:test";

import {
  annualLeavePace,
  daysBetween,
  fiscalYearLabel,
  fiscalYearOf,
  fiscalYearRange,
  isPlannedRecord,
  recordAmountInRange,
  summarizeAnnualLeave,
} from "@/lib/annual-leave";
import type { WorkRecordItem } from "@/types/work";

function record(overrides: Partial<WorkRecordItem>): WorkRecordItem {
  return {
    id: "r1",
    title: "年休",
    startDate: "2026-04-10",
    endDate: "2026-04-10",
    place: null,
    annualLeave: "全休",
    businessTrip: false,
    companyHoliday: false,
    preApplied: false,
    postRegistered: false,
    memo: null,
    segments: [],
    segmentsText: null,
    segmentsInvalid: false,
    url: null,
    ...overrides,
  };
}

test("fiscalYearOf: 開始月4月なら3/31は前年度・4/1は当年度", () => {
  assert.equal(fiscalYearOf("2026-03-31", 4), 2025);
  assert.equal(fiscalYearOf("2026-04-01", 4), 2026);
});

test("fiscalYearOf: 開始月1月なら暦年そのもの", () => {
  assert.equal(fiscalYearOf("2026-01-01", 1), 2026);
  assert.equal(fiscalYearOf("2025-12-31", 1), 2025);
});

test("fiscalYearRange: 4月開始の年度はうるう年をまたいでも翌年3/31で終わる", () => {
  assert.deepEqual(fiscalYearRange(2027, 4), { from: "2027-04-01", to: "2028-03-31" });
});

test("fiscalYearLabel: 開始月1月は「年度」を付けず暦年として出す", () => {
  assert.equal(fiscalYearLabel(2026, 1), "2026年");
  assert.equal(fiscalYearLabel(2026, 4), "2026年度");
});

test("daysBetween: 両端を含めて数える", () => {
  assert.equal(daysBetween("2026-08-12", "2026-08-16"), 5);
  assert.equal(daysBetween("2026-08-12", "2026-08-12"), 1);
});

test("summarizeAnnualLeave: 期間の全休は土日祝を数えない（issue #520）", () => {
  // 2026-08-12(水)〜2026-08-16(日): 土日を除くと 12・13・14 の3日ぶん。
  const records = [record({ startDate: "2026-08-12", endDate: "2026-08-16" })];
  const summary = summarizeAnnualLeave(
    records,
    { from: "2026-04-01", to: "2027-03-31" },
    "2026-12-31",
  );
  assert.equal(summary.taken.days, 3);
  assert.equal(summary.taken.hours, 0);
});

test("summarizeAnnualLeave: 単日の全休は土曜でもそのまま1日として数える", () => {
  // 2026-08-15は土曜日。単日登録は土日祝でも数える。
  const records = [record({ startDate: "2026-08-15", endDate: "2026-08-15" })];
  const summary = summarizeAnnualLeave(
    records,
    { from: "2026-04-01", to: "2027-03-31" },
    "2026-12-31",
  );
  assert.equal(summary.taken.days, 1);
});

test("summarizeAnnualLeave: 半休は0.5日として数える", () => {
  const records = [
    record({ startDate: "2026-04-10", endDate: "2026-04-10", annualLeave: "午前半休" }),
  ];
  const summary = summarizeAnnualLeave(
    records,
    { from: "2026-04-01", to: "2027-03-31" },
    "2026-12-31",
  );
  assert.equal(summary.taken.days, 0.5);
  assert.equal(summary.taken.hours, 0);
});

test("summarizeAnnualLeave: 時間休は日数を持たず時間の側だけへ足す（issue #537）", () => {
  const records = [
    record({ startDate: "2026-04-10", endDate: "2026-04-10", annualLeave: "3時間休" }),
  ];
  const summary = summarizeAnnualLeave(
    records,
    { from: "2026-04-01", to: "2027-03-31" },
    "2026-12-31",
  );
  assert.equal(summary.taken.days, 0);
  assert.equal(summary.taken.hours, 3);
});

test("summarizeAnnualLeave: 今日以前はtaken・今日より後はplannedへ分かれる", () => {
  const records = [
    record({ startDate: "2026-04-10", endDate: "2026-04-10" }),
    record({ id: "r2", startDate: "2026-05-01", endDate: "2026-05-01" }),
  ];
  const summary = summarizeAnnualLeave(
    records,
    { from: "2026-04-01", to: "2027-03-31" },
    "2026-04-30",
  );
  assert.equal(summary.taken.days, 1);
  assert.equal(summary.planned.days, 1);
});

test("summarizeAnnualLeave: 年度をまたぐ記録は年度に入っている日だけを数える", () => {
  // 2026-03-30〜2026-04-02のうち、4月開始の2026年度に入るのは4/1・4/2の2日。
  const records = [record({ startDate: "2026-03-30", endDate: "2026-04-02" })];
  const summary = summarizeAnnualLeave(
    records,
    { from: "2026-04-01", to: "2027-03-31" },
    "2026-12-31",
  );
  assert.equal(summary.taken.days, 2);
});

test("recordAmountInRange: summarizeAnnualLeaveと同じ数え方で1件ぶんを返す", () => {
  const range = { from: "2026-04-01", to: "2027-03-31" };
  const withinRecord = record({ startDate: "2026-08-12", endDate: "2026-08-16" });
  assert.deepEqual(recordAmountInRange(withinRecord, range), { days: 3, hours: 0 });
});

test("recordAmountInRange: 年休でない記録は0を返す", () => {
  const range = { from: "2026-04-01", to: "2027-03-31" };
  const notLeave = record({ annualLeave: null });
  assert.deepEqual(recordAmountInRange(notLeave, range), { days: 0, hours: 0 });
});

test("isPlannedRecord: 開始日が今日より後だけをplannedとする", () => {
  assert.equal(isPlannedRecord(record({ startDate: "2026-05-01" }), "2026-04-30"), true);
  assert.equal(isPlannedRecord(record({ startDate: "2026-04-30" }), "2026-04-30"), false);
  assert.equal(isPlannedRecord(record({ startDate: "2026-04-01" }), "2026-04-30"), false);
});

test("annualLeavePace: 年度が始まる前はnull", () => {
  const range = { from: "2026-04-01", to: "2027-03-31" };
  assert.equal(annualLeavePace({ totalDays: 20, taken: 0, range, todayKey: "2026-03-31" }), null);
});

test("annualLeavePace: 経過30日未満はprojectedTakenがnull", () => {
  const range = { from: "2026-04-01", to: "2027-03-31" };
  const pace = annualLeavePace({ totalDays: 20, taken: 2, range, todayKey: "2026-04-15" });
  assert.ok(pace);
  assert.equal(pace.elapsedDays, 15);
  assert.equal(pace.projectedTaken, null);
});

test("annualLeavePace: 経過30日以上でprojectedTakenを出す", () => {
  const range = { from: "2026-04-01", to: "2027-03-31" };
  const pace = annualLeavePace({ totalDays: 20, taken: 3, range, todayKey: "2026-05-01" });
  assert.ok(pace);
  assert.equal(pace.elapsedDays, 31);
  assert.ok(pace.projectedTaken !== null);
  // (3 / 31) * 365 の近似値。
  assert.ok(Math.abs((pace.projectedTaken ?? 0) - (3 / 31) * 365) < 1e-9);
});

test("annualLeavePace: diffは取得済み−想定（正なら早め、負ならゆっくり）", () => {
  const range = { from: "2026-01-01", to: "2026-12-31" };
  // 半分経過した時点で想定は totalDays/2。
  const pace = annualLeavePace({ totalDays: 20, taken: 12, range, todayKey: "2026-07-02" });
  assert.ok(pace);
  assert.ok(pace.diff > 0);
});
