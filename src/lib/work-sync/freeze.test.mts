import assert from "node:assert/strict";
import test from "node:test";

import { parseCommuteTitle, pickRowsToFreeze, type FreezeCandidate } from "@/lib/work-sync/freeze";

const pair = { origin: "勤務先", destination: "自宅" };
const row = (over: Partial<FreezeCandidate>): FreezeCandidate => ({
  id: "r",
  travelPlanId: "t",
  status: "ACTIVE",
  snapshot: { title: "勤務先 → 自宅" },
  ...over,
});

test("見出しから組を取り出す", () => {
  assert.deepEqual(parseCommuteTitle("勤務先 → 自宅"), pair);
  assert.equal(parseCommuteTitle("勤務先"), null);
  assert.equal(parseCommuteTitle(undefined), null);
});

test("他の日の同じ組の ACTIVE だけ据え置く", () => {
  const rows = [
    row({ id: "self", travelPlanId: "mine" }),
    row({ id: "other", travelPlanId: "t2" }),
    row({ id: "manual", status: "MANUAL" }),
    row({ id: "reverse", snapshot: { title: "自宅 → 勤務先" } }),
    row({ id: "notitle", snapshot: {} }),
  ];
  assert.deepEqual(pickRowsToFreeze(rows, pair, "mine"), ["other"]);
});
