import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planLinkedTravelShifts, shiftAmountLabel } from "@/lib/travel-follow";
import { yahooTransitLink } from "@/lib/yahoo-transit-link";

const previous = { start: "2026-10-10T10:00:00.000Z", end: "2026-10-10T11:00:00.000Z", allDay: false };
const before = { id: "b", start: "2026-10-10T09:00:00.000Z", end: "2026-10-10T09:45:00.000Z", linkedEventId: "e" };
const after = { id: "a", start: "2026-10-10T11:15:00.000Z", end: "2026-10-10T12:00:00.000Z", linkedEventId: "e" };
const overlap = { id: "o", start: "2026-10-10T10:30:00.000Z", end: "2026-10-10T10:45:00.000Z", linkedEventId: "e" };
const other = { id: "x", start: "2026-10-10T09:00:00.000Z", end: "2026-10-10T09:30:00.000Z", linkedEventId: "z" };

describe("planLinkedTravelShifts", () => {
  it("まるごと動かすと紐づく移動はすべて同じだけずれる", () => {
    const next = { start: "2026-10-10T10:30:00.000Z", end: "2026-10-10T11:30:00.000Z", allDay: false };
    const shifts = planLinkedTravelShifts([before, after, overlap, other], "e", previous, next);
    assert.deepEqual(
      shifts.map((s) => [s.travel.id, s.relation, s.deltaMs / 60_000]),
      [
        ["b", "before", 30],
        ["a", "after", 30],
        ["o", "related", 30],
      ],
    );
    assert.equal(shifts[0].start, "2026-10-10T09:30:00.000Z");
    assert.equal(shifts[0].end, "2026-10-10T10:15:00.000Z");
  });

  it("開始だけ引いたら予定前の移動だけずれる", () => {
    const next = { start: "2026-10-10T09:30:00.000Z", end: previous.end, allDay: false };
    const shifts = planLinkedTravelShifts([before, after, overlap], "e", previous, next);
    assert.deepEqual(shifts.map((s) => [s.travel.id, s.deltaMs / 60_000]), [["b", -30]]);
  });

  it("終了だけ引いたら予定後の移動だけずれる", () => {
    const next = { start: previous.start, end: "2026-10-10T12:00:00.000Z", allDay: false };
    const shifts = planLinkedTravelShifts([before, after, overlap], "e", previous, next);
    assert.deepEqual(shifts.map((s) => s.travel.id), ["a"]);
  });

  it("時刻が変わらない・終日なら候補は無い", () => {
    assert.deepEqual(planLinkedTravelShifts([before], "e", previous, previous), []);
    const allDay = { start: "2026-10-10", end: "2026-10-11", allDay: true };
    assert.deepEqual(planLinkedTravelShifts([before], "e", allDay, { ...allDay, start: "2026-10-12" }), []);
  });
});

describe("shiftAmountLabel", () => {
  it("ずれの量を日本語で言う", () => {
    assert.equal(shiftAmountLabel(30 * 60_000), "30分あと");
    assert.equal(shiftAmountLabel(-75 * 60_000), "1時間15分まえ");
    assert.equal(shiftAmountLabel(24 * 60 * 60_000), "1日あと");
  });
});

describe("yahooTransitLink", () => {
  it("到着時刻を指定して検索URLを組む", () => {
    const url = yahooTransitLink({
      origin: { name: "渋谷", query: "渋谷", coordinates: null },
      destination: { name: "梅田", query: "梅田", coordinates: null },
      departAt: "2026-10-10T09:30",
      arriveAt: "2026-10-10T10:05",
      basis: "arrive",
    });
    const params = new URL(url).searchParams;
    assert.equal(params.get("from"), "渋谷");
    assert.equal(params.get("hh"), "10");
    assert.equal(params.get("m1"), "0");
    assert.equal(params.get("m2"), "5");
    assert.equal(params.get("type"), "4");
  });
  it("地点が欠けたらトップページ", () => {
    const url = yahooTransitLink({ origin: null, destination: null, departAt: "", arriveAt: "" });
    assert.equal(url, "https://transit.yahoo.co.jp/");
  });
});
