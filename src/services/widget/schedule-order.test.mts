import assert from "node:assert/strict";
import { test } from "node:test";

import { orderScheduleItems } from "@/services/widget/schedule-order";

function item(title: string, start: string | null, end: string | null) {
  return {
    kind: "event" as const,
    title,
    allDay: start === null,
    start,
    end,
    detail: null,
    mode: null,
    origin: null,
    destination: null,
    outcome: null,
  };
}

const now = new Date("2026-10-22T05:00:00Z");

test("済んだ予定も後ろへ回さず時間順に並べる（issue #1325）", () => {
  const ordered = orderScheduleItems(
    [
      item("夕食", "2026-10-22T10:00:00Z", "2026-10-22T11:00:00Z"),
      item("朝会", "2026-10-22T00:00:00Z", "2026-10-22T01:00:00Z"),
      item("打合せ", "2026-10-22T06:00:00Z", "2026-10-22T07:00:00Z"),
      item("出張", null, null),
    ],
    now,
  );

  assert.deepEqual(
    ordered.map((it) => [it.title, it.past]),
    [
      ["出張", false],
      ["朝会", true],
      ["打合せ", false],
      ["夕食", false],
    ],
  );
});

test("ちょうど終わった予定は済んだものとして扱う", () => {
  const [only] = orderScheduleItems([item("昼食", "2026-10-22T04:00:00Z", "2026-10-22T05:00:00Z")], now);
  assert.equal(only?.past, true);
});
