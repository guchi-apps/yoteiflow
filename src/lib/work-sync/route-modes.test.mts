import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRouteLookup, pickDefaultRoute, type RouteModeRow } from "@/lib/work-sync/route-modes";

const row = (mode: RouteModeRow["mode"], minutes: number, isDefault = false, updatedAt = 0): RouteModeRow => ({
  origin: "自宅",
  destination: "門真",
  mode,
  minutes,
  isDefault,
  updatedAt,
});

test("既定の行があればそれを、無ければ固定順の先頭を選ぶ", () => {
  assert.equal(pickDefaultRoute([row("WALK", 90), row("PUBLIC_TRANSIT", 50, true)])?.mode, "PUBLIC_TRANSIT");
  assert.equal(pickDefaultRoute([row("WALK", 90), row("PUBLIC_TRANSIT", 50)])?.mode, "PUBLIC_TRANSIT");
  assert.equal(pickDefaultRoute([row("OTHER", 1), row("CAR", 35)])?.mode, "CAR");
  assert.equal(pickDefaultRoute([]), null);
});

test("既定が複数あっても、更新の新しい行へ決定的に決まる", () => {
  const a = [row("CAR", 35, true, 1), row("WALK", 90, true, 2)];
  assert.equal(pickDefaultRoute(a)?.mode, "WALK");
  assert.equal(pickDefaultRoute([...a].reverse())?.mode, "WALK");
});

test("lookup は方法を省略すると既定、指定するとその方法だけを返す", () => {
  const lookup = buildRouteLookup([row("CAR", 35), row("PUBLIC_TRANSIT", 50, true)]);
  assert.deepEqual(lookup("自宅", "門真"), { minutes: 50, mode: "PUBLIC_TRANSIT" });
  assert.deepEqual(lookup("自宅", "門真", "CAR"), { minutes: 35, mode: "CAR" });
  assert.equal(lookup("自宅", "門真", "WALK"), null);
  assert.equal(lookup("門真", "自宅"), null);
});
