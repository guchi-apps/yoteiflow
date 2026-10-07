import assert from "node:assert/strict";
import test from "node:test";

import {
  createCalendarDateUtils,
  taskOccurrenceCalendarDate,
  taskOccurrences,
  type TaskOccurrence,
} from "@/components/calendar/item-layout";
import type { CalendarEventItem, TaskItem, TravelItem } from "@/types/calendar";

function task(overrides: Partial<TaskItem>): TaskItem {
  return {
    kind: "task",
    id: "task-1",
    title: "タスク",
    due: null,
    hasTime: false,
    planned: null,
    plannedHasTime: false,
    done: false,
    skipped: false,
    canSkip: false,
    progress: null,
    canProgress: false,
    priority: null,
    tags: [],
    memo: null,
    recurrence: null,
    links: [],
    url: null,
    ...overrides,
  };
}

function occurrence(field: TaskOccurrence["field"], date: string): TaskOccurrence {
  return { task: task({}), field, date, hasTime: date.includes("T"), key: `task-1:${field}` };
}

test("期限切れの期限だけを今日へ配置する", () => {
  const dateKey = (date: string) => date.slice(0, 10);

  assert.equal(
    taskOccurrenceCalendarDate(occurrence("due", "2026-09-25"), dateKey, "2026-09-27"),
    "2026-09-27",
  );
  assert.equal(
    taskOccurrenceCalendarDate(occurrence("planned", "2026-09-25"), dateKey, "2026-09-27"),
    "2026-09-25",
  );
  assert.equal(
    taskOccurrenceCalendarDate(occurrence("due", "2026-09-28"), dateKey, "2026-09-27"),
    "2026-09-28",
  );
});

test("月表示では移動後の配置日が同じ期限と予定日だけをまとめる", () => {
  const sameToday = task({ due: "2026-09-27", planned: "2026-09-27" });
  assert.equal(taskOccurrences(sameToday, (date) => date, "2026-09-27").length, 1);

  const dueOverdue = task({ due: "2026-09-25", planned: "2026-09-25" });
  assert.equal(taskOccurrences(dueOverdue, (date) => date, "2026-09-27").length, 2);
  assert.equal(taskOccurrences(dueOverdue, undefined, "2026-09-27").length, 2);
});

test("時間が重なる予定と移動は別の列になり、隣接するだけなら全幅のまま", () => {
  const utils = createCalendarDateUtils("Asia/Tokyo");
  const event = (id: string, start: string, end: string) =>
    ({ kind: "event", id, start, end }) as never as CalendarEventItem;
  const travel = (id: string, start: string, end: string) =>
    ({ kind: "travel", id, start, end }) as never as TravelItem;
  const day = "2026-10-07";

  const overlapping = utils.layoutOverlaps(
    [event("e", "2026-10-07T09:00:00+09:00", "2026-10-07T10:00:00+09:00"),
     travel("t", "2026-10-07T09:30:00+09:00", "2026-10-07T10:30:00+09:00")],
    day,
  );
  assert.deepEqual(overlapping.map((x) => [x.event.id, x.column, x.columns]), [
    ["e", 0, 2],
    ["t", 1, 2],
  ]);

  const adjacent = utils.layoutOverlaps(
    [travel("t", "2026-10-07T08:50:00+09:00", "2026-10-07T09:00:00+09:00"),
     event("e", "2026-10-07T09:00:00+09:00", "2026-10-07T10:00:00+09:00")],
    day,
  );
  assert.deepEqual(adjacent.map((x) => [x.event.id, x.column, x.columns]), [
    ["t", 0, 1],
    ["e", 0, 1],
  ]);
});
