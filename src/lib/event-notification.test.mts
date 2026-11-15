import assert from "node:assert/strict";
import test from "node:test";

import {
  eventLeadAnnouncement,
  eventLeadLabel,
  eventNotificationSummary,
  leadMinutesToWheelTime,
  nextLeadMinutesToAdd,
  wheelTimeToLeadMinutes,
  isValidLeadMinutes,
  normalizeLeadMinutes,
  resolveEventLeadMinutes,
  sameNotificationOverride,
} from "@/lib/event-notification";
import { MAX_EVENT_LEAD_MINUTES, PLAN_WINDOW_HOURS } from "@/types/notification";

test("isValidLeadMinutes: 0以上・上限以下の整数はtrue", () => {
  assert.equal(isValidLeadMinutes(0), true);
  assert.equal(isValidLeadMinutes(90), true);
  assert.equal(isValidLeadMinutes(MAX_EVENT_LEAD_MINUTES), true);
});

test("isValidLeadMinutes: 負の値・非整数・上限超えはfalse", () => {
  assert.equal(isValidLeadMinutes(-5), false);
  assert.equal(isValidLeadMinutes(1.5), false);
  assert.equal(isValidLeadMinutes(MAX_EVENT_LEAD_MINUTES + 1), false);
});

test("normalizeLeadMinutes: 有効な値を残し、重複を除いて昇順に並べる", () => {
  assert.deepEqual(normalizeLeadMinutes([30, 10, 10, 0]), [0, 10, 30]);
});

test("normalizeLeadMinutes: 負の値・非整数・上限超えは落とす", () => {
  assert.deepEqual(normalizeLeadMinutes([10, 7, -5, 999, 1.5, MAX_EVENT_LEAD_MINUTES + 1]), [
    7, 10, 999,
  ]);
});

test("normalizeLeadMinutes: 空配列は空配列のまま", () => {
  assert.deepEqual(normalizeLeadMinutes([]), []);
});

test("MAX_EVENT_LEAD_MINUTESは下書きの先読み範囲(PLAN_WINDOW_HOURS)より十分小さい", () => {
  assert.ok(MAX_EVENT_LEAD_MINUTES < PLAN_WINDOW_HOURS * 60);
});

test("resolveEventLeadMinutes: 上書きが無ければ通知しない（オプトイン）", () => {
  assert.deepEqual(resolveEventLeadMinutes(null, true), []);
});

test("resolveEventLeadMinutes: 通知を入れていない上書きは空", () => {
  assert.deepEqual(resolveEventLeadMinutes({ enabled: false, leadMinutes: [10] }, true), []);
});

test("resolveEventLeadMinutes: 通知を入れた予定は指定のleadMinutesをそのまま使う", () => {
  assert.deepEqual(resolveEventLeadMinutes({ enabled: true, leadMinutes: [10, 30] }, true), [
    10, 30,
  ]);
});

test("resolveEventLeadMinutes: アカウントの予定通知がオフなら入れた予定も空", () => {
  assert.deepEqual(resolveEventLeadMinutes({ enabled: true, leadMinutes: [10] }, false), []);
});

test("eventLeadLabel: 0分は「ちょうど」", () => {
  assert.equal(eventLeadLabel(0), "ちょうど");
});

test("eventLeadLabel: 60分未満は分表記", () => {
  assert.equal(eventLeadLabel(10), "10分前");
});

test("eventLeadLabel: 60の倍数は時間表記", () => {
  assert.equal(eventLeadLabel(60), "1時間前");
  assert.equal(eventLeadLabel(1440), "24時間前");
});

test("eventLeadLabel: 60の倍数でない値は時間＋分の複合表記", () => {
  assert.equal(eventLeadLabel(90), "1時間30分前");
});

test("eventLeadAnnouncement: これから始まることが分かる「後」の言い方", () => {
  assert.equal(eventLeadAnnouncement(10), "10分後");
  assert.equal(eventLeadAnnouncement(90), "1時間30分後");
});

test("eventNotificationSummary: 未設定は「通知」", () => {
  assert.equal(eventNotificationSummary(null), "通知");
});

test("eventNotificationSummary: 無効な上書きも「通知」", () => {
  assert.equal(eventNotificationSummary({ enabled: false, leadMinutes: [10] }), "通知");
});

test("eventNotificationSummary: 1件は「通知：◯◯前」", () => {
  assert.equal(eventNotificationSummary({ enabled: true, leadMinutes: [10] }), "通知：10分前");
});

test("eventNotificationSummary: 複数件は先頭＋件数でまとめる（呼び出し側は昇順で渡す前提）", () => {
  assert.equal(
    eventNotificationSummary({ enabled: true, leadMinutes: [10, 30] }),
    "通知：10分前 ほか1件",
  );
});

test("sameNotificationOverride: 両方nullは同じ", () => {
  assert.equal(sameNotificationOverride(null, null), true);
});

test("sameNotificationOverride: 両方無効（leadMinutesが違っても）は同じ", () => {
  assert.equal(
    sameNotificationOverride(
      { enabled: false, leadMinutes: [10] },
      { enabled: false, leadMinutes: [30] },
    ),
    true,
  );
});

test("sameNotificationOverride: nullと無効は同じ扱い", () => {
  assert.equal(sameNotificationOverride(null, { enabled: false, leadMinutes: [10] }), true);
});

test("sameNotificationOverride: 有効↔無効は違う", () => {
  assert.equal(sameNotificationOverride(null, { enabled: true, leadMinutes: [10] }), false);
});

test("sameNotificationOverride: leadMinutesの並びが違っても集合が同じなら同じ", () => {
  assert.equal(
    sameNotificationOverride(
      { enabled: true, leadMinutes: [30, 10] },
      { enabled: true, leadMinutes: [10, 30] },
    ),
    true,
  );
});

test("sameNotificationOverride: leadMinutesの集合が違えば違う", () => {
  assert.equal(
    sameNotificationOverride(
      { enabled: true, leadMinutes: [10] },
      { enabled: true, leadMinutes: [10, 30] },
    ),
    false,
  );
});

test("nextLeadMinutesToAdd: 空なら10分、使用済みを避ける", () => {
  assert.equal(nextLeadMinutesToAdd([]), 10);
  assert.equal(nextLeadMinutesToAdd([10]), 5);
  assert.equal(nextLeadMinutesToAdd([10, 5, 15, 30, 60, 0, 120, 180]), 1);
});

test("leadMinutesToWheelTime / wheelTimeToLeadMinutes: 往復できる。24時間は23:59へ丸める", () => {
  assert.equal(leadMinutesToWheelTime(10), "00:10");
  assert.equal(leadMinutesToWheelTime(90), "01:30");
  assert.equal(leadMinutesToWheelTime(MAX_EVENT_LEAD_MINUTES), "23:59");
  assert.equal(wheelTimeToLeadMinutes("01:30"), 90);
  assert.equal(wheelTimeToLeadMinutes("bad"), 0);
});
