import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initialLegWalkText,
  initialWalkText,
  nearestStationName,
  nearestStationWalk,
  placeForWorkPlace,
} from "@/lib/work-sync/place-walk";
import type { PlaceItem } from "@/services/notion/places";

const place = (over: Partial<PlaceItem>): PlaceItem => ({
  id: "p1",
  name: "門真事業所",
  address: null,
  tags: [],
  coordinates: null,
  station: null,
  ...over,
});

test("紐づけ先を優先し、無ければ同名の場所を使う", () => {
  const a = place({ id: "a", name: "門真" });
  const b = place({ id: "b", name: "門真事業所" });
  assert.equal(placeForWorkPlace("門真", "b", [a, b])?.id, "b");
  assert.equal(placeForWorkPlace("門真", null, [a, b])?.id, "a");
  assert.equal(placeForWorkPlace("門真", "zzz", [a, b])?.id, "a");
  assert.equal(placeForWorkPlace("栗東", null, [a, b]), null);
});

test("最寄り駅の徒歩分と駅名は先頭の駅から取る", () => {
  const p = place({ stations: [{ name: "大日駅", minutes: 8 }, { name: "門真市駅", minutes: 15 }] });
  assert.equal(nearestStationWalk(p), 8);
  assert.equal(nearestStationName(p), "大日駅");
  assert.equal(nearestStationWalk(null), null);
  assert.equal(nearestStationWalk(place({ stations: [{ name: "大日駅", minutes: null }] })), null);
});

test("駅そのものの場所は最寄り駅を使わない", () => {
  const p = place({ tags: ["駅・空港"], stations: [{ name: "大日駅", minutes: 8 }] });
  assert.equal(nearestStationWalk(p), null);
});

test("保存済みの値を最寄り駅より優先する", () => {
  assert.equal(initialWalkText(5, 20), "5");
  assert.equal(initialWalkText(0, 20), "0");
  assert.equal(initialWalkText(null, 20), "20");
  assert.equal(initialWalkText(undefined, null), "");
});

test("往路・復路の徒歩は保存済み（0分含む）→最寄り駅の合計→空の順", () => {
  assert.equal(initialLegWalkText(12, 20, 8), "12");
  assert.equal(initialLegWalkText(null, 20, 8), "28");
  assert.equal(initialLegWalkText(0, 20, 8), "0");
  assert.equal(initialLegWalkText(null, 20, null), "20");
  assert.equal(initialLegWalkText(null, null, null), "");
});
