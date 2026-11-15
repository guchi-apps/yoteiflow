import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeInternalEventUpdate } from "@/services/internal/event-update";

const timed = {
  id: "a",
  summary: "歯医者",
  start: { dateTime: "2026-09-07T10:00:00+09:00" },
  end: { dateTime: "2026-09-07T11:00:00+09:00" },
};

/** 日をまたぐ時刻ありの予定（issue #813）。23:00〜翌06:00の夜勤。 */
const overnight = {
  id: "c",
  summary: "夜勤",
  start: { dateTime: "2026-09-07T23:00:00+09:00" },
  end: { dateTime: "2026-09-08T06:00:00+09:00" },
};

test("時刻だけ送ると日付とタイトルは今のまま", () => {
  const r = mergeInternalEventUpdate(timed, { startTime: "14:00", endTime: "15:00" }, "Asia/Tokyo");
  assert.ok(r.ok);
  assert.equal(r.input.title, "歯医者");
  assert.equal(r.input.start, "2026-09-07T05:00:00.000Z");
});

test("日付だけ送ると時刻を保ったまま動く", () => {
  const r = mergeInternalEventUpdate(timed, { date: "2026-09-08" }, "Asia/Tokyo");
  assert.ok(r.ok);
  assert.equal(r.input.start, "2026-09-08T01:00:00.000Z");
  assert.equal(r.input.end, "2026-09-08T02:00:00.000Z");
});

test("片方だけの時刻・終了が開始以前は400", () => {
  const a = mergeInternalEventUpdate(timed, { startTime: "14:00" }, "Asia/Tokyo");
  assert.ok(!a.ok && a.status === 400);
  const b = mergeInternalEventUpdate(timed, { startTime: "14:00", endTime: "14:00" }, "Asia/Tokyo");
  assert.ok(!b.ok && b.status === 400);
});

test("繰り返しの親は409", () => {
  const a = mergeInternalEventUpdate({ ...timed, recurrence: ["RRULE:FREQ=WEEKLY"] }, { title: "x" }, "Asia/Tokyo");
  assert.ok(!a.ok && a.status === 409 && a.error === "recurring_master_unsupported");
});

test("複数日にまたがる終日予定（出張など）は409", () => {
  const trip = { id: "d", summary: "出張", start: { date: "2026-09-10" }, end: { date: "2026-09-13" } };
  const r = mergeInternalEventUpdate(trip, { title: "x" }, "Asia/Tokyo");
  assert.ok(!r.ok && r.status === 409 && r.error === "multi_day_event_unsupported");
});

test("終日から時刻ありへは時刻が要る。終日への変更は date 形式", () => {
  const allDay = { id: "b", summary: "出張", start: { date: "2026-09-10" }, end: { date: "2026-09-11" } };
  const a = mergeInternalEventUpdate(allDay, { allDay: false }, "Asia/Tokyo");
  assert.ok(!a.ok && a.status === 400);
  const b = mergeInternalEventUpdate(allDay, { date: "2026-09-12" }, "Asia/Tokyo");
  assert.ok(b.ok && b.input.allDay && b.input.start === "2026-09-12");
  const c = mergeInternalEventUpdate(timed, { allDay: true }, "Asia/Tokyo");
  assert.ok(c.ok && c.input.allDay && c.input.start === "2026-09-07");
});

test("日をまたぐ時刻ありの予定は、endDateを送らなければまたぎ幅を保ったまま動く（issue #813）", () => {
  const titleOnly = mergeInternalEventUpdate(overnight, { title: "夜勤（変更）" }, "Asia/Tokyo");
  assert.ok(titleOnly.ok);
  assert.equal(titleOnly.input.title, "夜勤（変更）");
  assert.equal(titleOnly.input.start, "2026-09-07T14:00:00.000Z");
  assert.equal(titleOnly.input.end, "2026-09-07T21:00:00.000Z");

  // date だけ動かすと、今のまたぎ幅（1日）を保って終了日も一緒にずれる。
  const shifted = mergeInternalEventUpdate(overnight, { date: "2026-09-10" }, "Asia/Tokyo");
  assert.ok(shifted.ok);
  assert.equal(shifted.input.start, "2026-09-10T14:00:00.000Z");
  assert.equal(shifted.input.end, "2026-09-10T21:00:00.000Z");
});

test("日をまたぐ時刻ありの予定は、date + endDate を明示すれば新しい終了日で動く（issue #813）", () => {
  const r = mergeInternalEventUpdate(
    overnight,
    { date: "2026-09-20", endDate: "2026-09-22", startTime: "10:00", endTime: "09:00" },
    "Asia/Tokyo",
  );
  assert.ok(r.ok);
  // endTime(09:00) は startTime(10:00) より時刻としては前だが、日をまたぐので有効。
  assert.equal(r.input.start, "2026-09-20T01:00:00.000Z");
  assert.equal(r.input.end, "2026-09-22T00:00:00.000Z");
});

test("同日の予定もendDateだけで日をまたぐ予定に変えられる（issue #813）", () => {
  const r = mergeInternalEventUpdate(timed, { endDate: "2026-09-08" }, "Asia/Tokyo");
  assert.ok(r.ok);
  assert.equal(r.input.start, "2026-09-07T01:00:00.000Z");
  assert.equal(r.input.end, "2026-09-08T02:00:00.000Z");
});

test("終了日時が開始日時以前は400（日をまたいでも実際の日時どうしで比べる。issue #813）", () => {
  const r = mergeInternalEventUpdate(overnight, { date: "2026-09-10", endDate: "2026-09-09" }, "Asia/Tokyo");
  assert.ok(!r.ok && r.status === 400 && r.error === "endTime must be after startTime");
});

test("endDateの形式が不正なら400（issue #813）", () => {
  const r = mergeInternalEventUpdate(overnight, { endDate: "2026-13-01" }, "Asia/Tokyo");
  assert.ok(!r.ok && r.status === 400 && r.error === "endDate must be a valid date in YYYY-MM-DD format");
});

test("allDayとendDateの同時指定は400（issue #813）", () => {
  const r = mergeInternalEventUpdate(timed, { allDay: true, endDate: "2026-09-08" }, "Asia/Tokyo");
  assert.ok(!r.ok && r.status === 400 && r.error === "endDate cannot be combined with allDay");
});

test("descriptionは省略で触らず、文字列で書き、空文字で消す（issue #1530）", () => {
  const keep = mergeInternalEventUpdate(timed, { title: "x" }, "Asia/Tokyo");
  assert.ok(keep.ok);
  assert.equal(keep.input.description, undefined);
  const set = mergeInternalEventUpdate(timed, { description: " 持ち物: 保険証 " }, "Asia/Tokyo");
  assert.ok(set.ok);
  assert.equal(set.input.description, "持ち物: 保険証");
  const clear = mergeInternalEventUpdate(timed, { description: "" }, "Asia/Tokyo");
  assert.ok(clear.ok);
  assert.equal(clear.input.description, "");
});
