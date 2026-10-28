import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildRouteLookup,
  pickDefaultRoute,
  transitBaseTrain,
  transitMinutes,
  type RouteModeRow,
} from "@/lib/work-sync/route-modes";

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

const train = (departMinutes: number, durationMinutes: number, isDefault = false) => ({
  departMinutes,
  durationMinutes,
  isDefault,
});

test("公共交通の所要分は、デフォルトの電車の所要分に徒歩を足す", () => {
  const trains = [train(420, 40), train(450, 35, true)];
  assert.equal(transitMinutes(trains, 15), 50);
  assert.equal(transitBaseTrain(trains)?.durationMinutes, 35);
});

test("デフォルトの電車が無ければ出発が最も早い電車を基準にし、電車が無ければ null", () => {
  assert.equal(transitMinutes([train(450, 35), train(420, 40)], 10), 50);
  assert.equal(transitMinutes([], 10), null);
  assert.equal(transitMinutes([train(420, 40)], -5), 40);
});
