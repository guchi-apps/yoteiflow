import assert from "node:assert/strict";
import test from "node:test";

import { ensureStationSuffix, yahooSearchStationName } from "@/lib/station-name";

test("ensureStationSuffix: 駅が無ければ補い、あれば触らない", () => {
  assert.equal(ensureStationSuffix("梅田"), "梅田駅");
  assert.equal(ensureStationSuffix(" 梅田駅 "), "梅田駅");
  assert.equal(ensureStationSuffix("  "), null);
  assert.equal(ensureStationSuffix(null), null);
});

test("yahooSearchStationName: 末尾の駅だけ外す", () => {
  assert.equal(yahooSearchStationName("梅田駅"), "梅田");
  assert.equal(yahooSearchStationName("梅田"), "梅田");
  assert.equal(yahooSearchStationName("駅"), "駅");
  assert.equal(yahooSearchStationName("駅前"), "駅前");
});
