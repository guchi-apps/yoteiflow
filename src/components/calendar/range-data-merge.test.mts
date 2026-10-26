import assert from "node:assert/strict";
import test from "node:test";

import {
  hasGoogleFailure,
  mergeCalendars,
  mergeFailedItems,
  mergeRangeResponse,
  mergeStaleItems,
} from "@/components/calendar/range-data-merge";
import type { WorkRecordItem } from "@/types/work";
import type {
  CalendarEventItem,
  CalendarLoadResult,
  ReminderItem,
  TaskItem,
  TravelItem,
} from "@/types/calendar";

function event(id: string, calendarId = "main", title = id): CalendarEventItem {
  return { id, calendarId, title } as CalendarEventItem;
}

function task(id: string, title = id): TaskItem {
  return { id, title } as TaskItem;
}

function reminder(id: string, source: ReminderItem["source"] = "reminder"): ReminderItem {
  return { id, source, title: id } as ReminderItem;
}

function travel(id: string): TravelItem {
  return { id } as TravelItem;
}

function result(overrides: Partial<CalendarLoadResult> = {}): CalendarLoadResult {
  return {
    events: [],
    tasks: [],
    reminders: [],
    travels: [],
    workRecords: [],
    calendars: [],
    notionReady: true,
    reminderReady: true,
    errors: [],
    ...overrides,
  };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

test("確かな応答は丸ごと置き換える（完了した期限切れタスク・消えた予定も外れる）", () => {
  const current = result({ events: [event("a"), event("b")], tasks: [task("overdue")] });
  const incoming = result({ events: [event("a")], tasks: [] });

  const { data, merged } = mergeRangeResponse(current, incoming, { stale: false });

  assert.equal(merged, false);
  assert.equal(data, incoming);
});

test("保存済みの応答では表示中の項目を消さず、無い項目だけ足す（同じ項目は表示中を優先）", () => {
  const current = result({
    events: [event("a", "main", "新しい題名"), event("b")],
    tasks: [task("t1")],
    travels: [travel("v1")],
  });
  const incoming = result({
    events: [event("a", "main", "古い題名"), event("c")],
    tasks: [],
    travels: [travel("v2")],
  });

  const { data, merged } = mergeRangeResponse(current, incoming, { stale: true });

  assert.equal(merged, true);
  assert.deepEqual(ids(data.events), ["a", "b", "c"]);
  assert.equal(data.events[0].title, "新しい題名");
  assert.deepEqual(ids(data.tasks), ["t1"]);
  assert.deepEqual(ids(data.travels), ["v1", "v2"]);
});

test("Notionの失敗ではタスク・リマインド・勤務だけ残し、予定と移動は置き換える", () => {
  const current = result({
    events: [event("gone")],
    tasks: [task("t1", "古い")],
    reminders: [reminder("r1")],
    travels: [travel("v-old")],
  });
  const incoming = result({
    events: [event("new")],
    tasks: [task("t1", "新しい")],
    reminders: [],
    travels: [travel("v-new")],
    errors: [{ source: "notion", reason: "rate limited" }],
  });

  const { data, merged } = mergeRangeResponse(current, incoming, { stale: false });

  assert.equal(merged, true);
  assert.deepEqual(ids(data.events), ["new"]);
  assert.deepEqual(ids(data.travels), ["v-new"]);
  assert.deepEqual(ids(data.tasks), ["t1"]);
  // 届いたぶんは表示中より新しい。
  assert.equal(data.tasks[0].title, "新しい");
  assert.deepEqual(ids(data.reminders), ["r1"]);
});

test("Googleの失敗では予定と保存先の候補を残し、タスクは置き換える", () => {
  const calendar = { calendarId: "work", name: "仕事", color: null, isCreateDefault: false };
  const current = result({
    events: [event("e1", "work")],
    tasks: [task("done")],
    calendars: [calendar],
  });
  const incoming = result({
    events: [event("e2")],
    tasks: [],
    errors: [{ source: "google", reason: "failed" }],
  });

  const { data } = mergeRangeResponse(current, incoming, { stale: false });

  assert.deepEqual(ids(data.events), ["e2", "e1"]);
  assert.deepEqual(data.tasks, []);
  assert.deepEqual(data.calendars, [calendar]);
});

test("同じIDでもカレンダーが違う予定は別の項目として残す", () => {
  const current = result({ events: [event("shared", "main"), event("shared", "work")] });
  const incoming = result({ events: [event("shared", "main")] });

  const { data } = mergeRangeResponse(current, incoming, { stale: true });

  assert.deepEqual(
    data.events.map((item) => `${item.calendarId}:${item.id}`),
    ["main:shared", "work:shared"],
  );
});

test("毎年のリマインドは展開済みID（日付入り）ごとに残し、取得元が違えば別の項目にする", () => {
  const current = result({
    reminders: [reminder("p1:2026-10-26"), reminder("p1:2027-10-26"), reminder("x", "garbage")],
  });
  const incoming = result({
    reminders: [reminder("p1:2026-10-26"), reminder("x", "shopping")],
  });

  const { data } = mergeRangeResponse(current, incoming, { stale: true });

  assert.deepEqual(
    data.reminders.map((item) => `${item.source}:${item.id}`),
    ["reminder:p1:2026-10-26", "reminder:p1:2027-10-26", "garbage:x", "shopping:x"],
  );
});

test("mergeStaleItems: 月表示の保存済みでも、保存したばかりの予定・移動を消さない（issue #1408）", () => {
  const current = result({
    events: [event("old"), event("new", "main", "新しい予定")],
    travels: [travel("new-travel")],
    tasks: [task("t1", "表示中")],
  });
  // 保存前に保存された古い内容。新しい予定・移動が入っていない。
  const incoming = result({ events: [event("old", "main", "古い題名"), event("other")], tasks: [task("t1", "古い")] });

  const merged = mergeStaleItems(current, incoming);

  assert.deepEqual(
    merged.events.map((e) => `${e.id}:${e.title}`),
    ["old:old", "new:新しい予定", "other:other"],
  );
  assert.deepEqual(merged.travels.map((t) => t.id), ["new-travel"]);
  assert.equal(merged.tasks[0].title, "表示中");
});

function workRecord(id: string): WorkRecordItem {
  return { id } as WorkRecordItem;
}

test("月表示の一部失敗: Notionが失敗した月はタスク・リマインド・勤務場所を表示中のまま残す（issue #1425）", () => {
  const current = result({
    events: [event("old")],
    tasks: [task("t1")],
    reminders: [reminder("r1")],
    workRecords: [workRecord("w1")],
  });
  // サーバーはNotionが1つでも失敗すると、まとめて空で返す
  const incoming = result({ events: [event("new")], errors: [{ source: "notion", reason: "x" }] });

  const merged = mergeFailedItems(current, incoming, incoming.errors);

  // 成功したGoogleの予定は応答で置き換える
  assert.deepEqual(ids(merged.events), ["new"]);
  assert.deepEqual(ids(merged.tasks), ["t1"]);
  assert.deepEqual(ids(merged.reminders), ["r1"]);
  assert.deepEqual(ids(merged.workRecords), ["w1"]);
});

test("月表示の一部失敗: 失敗が無ければ応答をそのまま返す", () => {
  const current = result({ workRecords: [workRecord("w1")] });
  const incoming = result({ workRecords: [] });

  assert.equal(mergeFailedItems(current, incoming, []), incoming);
});

test("Googleの失敗では保存先の候補を残し、同じカレンダーは先に渡した側を採る", () => {
  const errors: CalendarLoadResult["errors"] = [{ source: "google", reason: "x" }];
  assert.equal(hasGoogleFailure(errors), true);
  assert.equal(hasGoogleFailure([{ source: "notion", reason: "x" }]), false);

  const merged = mergeCalendars(
    [{ calendarId: "a", name: "新", color: null, isCreateDefault: true }],
    [
      { calendarId: "a", name: "旧", color: null, isCreateDefault: true },
      { calendarId: "b", name: "B", color: null, isCreateDefault: false },
    ],
  );
  assert.deepEqual(
    merged.map((c) => `${c.calendarId}:${c.name}`),
    ["a:新", "b:B"],
  );
});
