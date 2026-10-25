import assert from "node:assert/strict";
import test from "node:test";

import { mergeRangeResponse } from "@/components/calendar/range-data-merge";
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
