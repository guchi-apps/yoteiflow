import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMailIdempotencyKey,
  buildApplyMail,
  dueApplyNotices,
  noticeDateFor,
  offDatesFromRecords,
  zonedDateAndHour,
} from "@/lib/work-apply-notice";
import type { WorkRecordItem } from "@/types/work";

function record(overrides: Partial<WorkRecordItem>): WorkRecordItem {
  return {
    id: "r1",
    title: "大阪",
    startDate: "2026-11-18",
    endDate: "2026-11-18",
    place: null,
    annualLeave: null,
    businessTrip: true,
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

test("通知日は開始日の前日（平日）", () => {
  // 2026-11-18 は水曜 → 前日の火曜 11-17
  assert.equal(noticeDateFor("2026-11-18", new Set()), "2026-11-17");
});

test("月曜の開始は直前の金曜", () => {
  // 2026-11-16 は月曜
  assert.equal(noticeDateFor("2026-11-16", new Set()), "2026-11-13");
});

test("祝日・年休を挟むと手前の出勤日へ遡る", () => {
  // 11-24(火)開始。前日11-23は勤労感謝の日（月）、11-20(金)が出勤日。
  assert.equal(noticeDateFor("2026-11-24", new Set()), "2026-11-20");
  // 11-20 が年休なら 11-19
  assert.equal(noticeDateFor("2026-11-24", new Set(["2026-11-20"])), "2026-11-19");
});

test("会社休業日・全休の年休だけを休みの日に数える（半休は数えない）", () => {
  const off = offDatesFromRecords([
    record({ id: "a", businessTrip: false, annualLeave: "全休", startDate: "2026-11-19", endDate: "2026-11-20" }),
    record({ id: "b", businessTrip: false, companyHoliday: true, startDate: "2026-11-18", endDate: "2026-11-18" }),
    record({ id: "c", businessTrip: false, annualLeave: "午前半休", startDate: "2026-11-17", endDate: "2026-11-17" }),
  ]);
  assert.deepEqual([...off].sort(), ["2026-11-18", "2026-11-19", "2026-11-20"]);
});

test("今日が通知日の未申請だけを返す", () => {
  const trip = record({ id: "t" });
  const done = record({ id: "d", preApplied: true });
  const leave = record({ id: "l", businessTrip: false, annualLeave: "全休", startDate: "2026-11-18" });
  const later = record({ id: "x", startDate: "2026-11-25", endDate: "2026-11-25" });
  const due = dueApplyNotices([trip, done, leave, later], new Set(), "2026-11-17");
  assert.deepEqual(due.map((r) => r.id).sort(), ["l", "t"]);
  assert.equal(dueApplyNotices([trip], new Set(), "2026-11-16").length, 0);
  // 開始日を過ぎた記録は対象外
  assert.equal(dueApplyNotices([trip], new Set(), "2026-11-18").length, 0);
});

test("設定タイムゾーンの日付と時", () => {
  // 2026-11-17T07:30:00Z = JST 16:30
  assert.deepEqual(zonedDateAndHour(new Date("2026-11-17T07:30:00Z"), "Asia/Tokyo"), {
    dateKey: "2026-11-17",
    hour: 16,
  });
  assert.equal(zonedDateAndHour(new Date("2026-11-17T20:00:00Z"), "Asia/Tokyo").dateKey, "2026-11-18");
});

test("メールの件名は改行を含まず、本文はエスケープされる", () => {
  const mail = buildApplyMail([record({ title: "<大阪>" }), record({ id: "l", businessTrip: false, annualLeave: "全休" })]);
  assert.ok(!/[\r\n]/.test(mail.subject));
  assert.ok(mail.subject.includes("2件"));
  assert.ok(mail.bodyHtml.includes("&lt;大阪&gt;"));
  assert.ok(mail.bodyText.includes("年休（全休）"));
});

test("冪等キーは順序によらず同じで200字以内", () => {
  const a = record({ id: "a" });
  const b = record({ id: "b" });
  const key = applyMailIdempotencyKey("2026-11-17", [a, b]);
  assert.equal(key, applyMailIdempotencyKey("2026-11-17", [b, a]));
  assert.ok(key.length <= 200);
  assert.notEqual(key, applyMailIdempotencyKey("2026-11-17", [a]));
});
