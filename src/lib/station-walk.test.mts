import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stationWalkMinutes } from "@/lib/station-walk";
import type { PlaceItem } from "@/services/notion/places";

const place = (over: Partial<PlaceItem>): PlaceItem => ({
  id: "p", name: "本社", address: null, tags: [], coordinates: null, station: "三宮駅", stationMinutes: 10, ...over,
});

describe("stationWalkMinutes", () => {
  it("最寄り駅がある場所の徒歩分を返す", () => {
    assert.equal(stationWalkMinutes("本社", [place({})]), 10);
  });
  it("最寄り駅が空なら無視する", () => {
    assert.equal(stationWalkMinutes("本社", [place({ station: null })]), 0);
  });
  it("駅・空港タグの場所は残った値も無視する", () => {
    assert.equal(stationWalkMinutes("本社", [place({ tags: ["駅・空港"] })]), 0);
  });
  it("場所が見つからない・場所欄が空なら0", () => {
    assert.equal(stationWalkMinutes("別の場所", [place({})]), 0);
    assert.equal(stationWalkMinutes(null, [place({})]), 0);
  });
});

describe("stationWalkMinutes（複数駅・issue #1607）", () => {
  const multi = place({
    station: "高槻駅",
    stationMinutes: 20,
    stations: [
      { name: "高槻駅", minutes: 20 },
      { name: "高槻市駅", minutes: 15 },
    ],
  });
  it("省略時は先頭の駅、指定した駅はその駅の徒歩", () => {
    assert.equal(stationWalkMinutes("本社", [multi]), 20);
    assert.equal(stationWalkMinutes("本社", [multi], "高槻市駅"), 15);
  });
  it("地点で探す（null）は0、登録に無い駅名は先頭", () => {
    assert.equal(stationWalkMinutes("本社", [multi], null), 0);
    assert.equal(stationWalkMinutes("本社", [multi], "茨木駅"), 20);
  });
});
