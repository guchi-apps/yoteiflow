import assert from "node:assert/strict";
import test from "node:test";

import { planTravelDrafts } from "@/services/notifications/plan-travels";

const now = new Date("2026-10-06T00:00:00Z");
const windowEnd = new Date("2026-10-07T12:00:00Z");
const format = { formatTime: (iso: string) => iso.slice(11, 16), itemDateKey: (iso: string) => iso.slice(0, 10) };
const travel = {
  id: "t1",
  origin: "自宅",
  destination: "渋谷",
  departAt: new Date("2026-10-06T09:00:00Z"),
  arriveAt: new Date("2026-10-06T10:00:00Z"),
};
const on = (leadMinutes: number[]) => new Map([["t1", { enabled: true, leadMinutes }]]);

test("通知を入れていない移動は作らない", () => {
  assert.equal(planTravelDrafts([travel], new Map(), true, now, windowEnd, format).length, 0);
  assert.equal(
    planTravelDrafts([travel], new Map([["t1", { enabled: false, leadMinutes: [10] }]]), true, now, windowEnd, format).length,
    0,
  );
});

test("複数の何分前ごとに別の下書きを作り、出発時刻から引く", () => {
  const drafts = planTravelDrafts([travel], on([10, 30]), true, now, windowEnd, format);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].scheduledAt.toISOString(), "2026-10-06T08:50:00.000Z");
  assert.notEqual(drafts[0].dedupeKey, drafts[1].dedupeKey);
  assert.equal(drafts[0].title, "10分後 自宅 → 渋谷");
});

test("親スイッチがオフなら作らない", () => {
  assert.equal(planTravelDrafts([travel], on([10]), false, now, windowEnd, format).length, 0);
});

test("通知時刻が過ぎているものは作らない", () => {
  const late = new Date("2026-10-06T08:55:00Z");
  assert.equal(planTravelDrafts([travel], on([10]), true, late, windowEnd, format).length, 0);
});
