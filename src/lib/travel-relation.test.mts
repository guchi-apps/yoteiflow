import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseRelationEvent, travelRelation } from "@/lib/travel-relation";

const event = { start: "2026-10-10T10:00:00.000Z", end: "2026-10-10T11:00:00.000Z" };

describe("travelRelation", () => {
  it("予定開始ちょうどの到着は予定前", () => {
    assert.equal(
      travelRelation({ start: "2026-10-10T09:00:00.000Z", end: event.start }, event),
      "before",
    );
  });
  it("予定終了ちょうどの出発は予定後", () => {
    assert.equal(
      travelRelation({ start: event.end, end: "2026-10-10T12:00:00.000Z" }, event),
      "after",
    );
  });
  it("日跨ぎの予定後の移動", () => {
    assert.equal(
      travelRelation(
        { start: "2026-10-11T00:30:00.000Z", end: "2026-10-11T02:00:00.000Z" },
        { start: "2026-10-10T20:00:00.000Z", end: "2026-10-11T00:30:00.000Z" },
      ),
      "after",
    );
  });
  it("時間が重なれば関連", () => {
    assert.equal(
      travelRelation({ start: "2026-10-10T10:30:00.000Z", end: "2026-10-10T11:30:00.000Z" }, event),
      "related",
    );
  });
  it("終日予定・予定なしは関連", () => {
    const t = { start: "2026-10-10T01:00:00.000Z", end: "2026-10-10T02:00:00.000Z" };
    assert.equal(travelRelation(t, { start: "2026-10-10", end: "2026-10-10" }), "related");
    assert.equal(travelRelation(t, null), "related");
  });
  it("日時が不正なら関連", () => {
    assert.equal(travelRelation({ start: "x", end: "y" }, event), "related");
  });
});

describe("parseRelationEvent", () => {
  it("2項目が文字列なら取れる", () => {
    assert.deepEqual(parseRelationEvent({ eventStart: "a", eventEnd: "b", eventAllDay: false }), {
      start: "a",
      end: "b",
      allDay: false,
    });
  });
  it("足りなければnull", () => {
    assert.equal(parseRelationEvent({ eventStart: "a" }), null);
  });
});
