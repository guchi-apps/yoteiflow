import assert from "node:assert/strict";
import test from "node:test";

import {
  createCalendarDateUtils,
  eventHeaderBand,
  MARK_ROW_HEIGHT,
  mergeMarkAvoidBands,
  stackMarkTops,
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

test("stackMarkTops: 近い時刻の印は行の高さぶん下へ積む", () => {
  const tops = stackMarkTops([
    { key: "a", top: 100 },
    { key: "b", top: 105 },
  ]);
  assert.equal(tops.get("a"), 100);
  assert.equal(tops.get("b"), 100 + MARK_ROW_HEIGHT);
});

test("stackMarkTops: 下限を超える印は上へ返す", () => {
  const tops = stackMarkTops([{ key: "a", top: 990 }], 980);
  assert.equal(tops.get("a"), 980);
});

test("stackMarkTops: 帯の上端に近い印は帯の上へ逃がす（issue #1733）", () => {
  const band = eventHeaderBand(100, 150);
  const tops = stackMarkTops([{ key: "a", top: 105 }], undefined, [band]);
  assert.equal(tops.get("a"), band.top - MARK_ROW_HEIGHT / 2);
});

test("stackMarkTops: 帯の下端に近い印は帯の下へ送る（issue #1675）", () => {
  const band = eventHeaderBand(100, 150);
  const tops = stackMarkTops([{ key: "a", top: band.bottom - 2 }], undefined, [band]);
  assert.equal(tops.get("a"), band.bottom + MARK_ROW_HEIGHT / 2);
});

test("stackMarkTops: 上が帯・前の印で塞がっていれば下へ送る", () => {
  const band = eventHeaderBand(100, 150);
  // 上は先頭の印の行（上端 half）に近く、帯の上へ置くと前の印と重なる。
  const tops = stackMarkTops(
    [
      { key: "a", top: 90 },
      { key: "b", top: 105 },
    ],
    undefined,
    [band],
  );
  assert.equal(tops.get("a"), 90);
  assert.equal(tops.get("b"), band.bottom + MARK_ROW_HEIGHT / 2);
});

test("stackMarkTops: 帯から離れた印は動かさない", () => {
  const tops = stackMarkTops([{ key: "a", top: 300 }], undefined, [eventHeaderBand(100, 150)]);
  assert.equal(tops.get("a"), 300);
});

test("stackMarkTops: 下限で戻すときも見出し帯へ入れず帯の上へ置く", () => {
  // 下限 980 の近くに予定の帯（970〜）がある。印は帯の上へ置く。
  const band = eventHeaderBand(970, 150);
  const tops = stackMarkTops([{ key: "a", top: 975 }], 980, [band]);
  const top = tops.get("a")!;
  assert.ok(top + MARK_ROW_HEIGHT / 2 <= band.top);
});

test("eventHeaderBand: 短い予定は実際の高さで頭打ちにする", () => {
  assert.equal(eventHeaderBand(50, 16).bottom, 66);
  assert.equal(eventHeaderBand(50, 500).bottom, 50 + 32);
});

test("mergeMarkAvoidBands: 重なる・接する帯を結合する", () => {
  const merged = mergeMarkAvoidBands([
    { top: 50, bottom: 80 },
    { top: 10, bottom: 30 },
    { top: 30, bottom: 40 },
  ]);
  assert.deepEqual(merged, [
    { top: 10, bottom: 40 },
    { top: 50, bottom: 80 },
  ]);
});
