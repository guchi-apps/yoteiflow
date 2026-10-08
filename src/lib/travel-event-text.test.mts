import assert from "node:assert/strict";
import test from "node:test";

import { travelEventTitle } from "@/lib/travel-event-text";

const base = { destination: "伊賀", mode: "CAR" as const, departAt: new Date("2026-10-08T00:00:00Z"), arriveAt: new Date("2026-10-08T01:00:00Z") };

test("Googleの予定タイトルは経由地を目的地の前に並べる", () => {
  assert.equal(travelEventTitle(base), "→ 伊賀（車 60分）");
  assert.equal(travelEventTitle({ ...base, via: JSON.stringify(["茨木"]) }), "→ 茨木 → 伊賀（車 60分）");
});

import { travelEventDescription } from "@/lib/travel-event-text";

test("説明欄に経由地を残す", () => {
  const text = travelEventDescription({ ...base, origin: "自宅", via: JSON.stringify(["茨木", "亀山"]), note: null, estimateSource: "MANUAL" });
  assert.match(text, /経由地: 茨木、亀山/);
  assert.doesNotMatch(travelEventDescription({ ...base, origin: "自宅", note: null, estimateSource: "MANUAL" }), /経由地/);
});
