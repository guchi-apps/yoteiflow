import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveYahooPlace } from "@/lib/yahoo-transit-link";
import type { PlaceItem } from "@/services/notion/places";

const home: PlaceItem = {
  id: "home",
  name: "自宅",
  address: "大阪府高槻市出丸町3-36",
  tags: [],
  coordinates: { lat: 34.84, lng: 135.61 },
  station: "高槻駅",
  stationMinutes: 20,
  stations: [
    { name: "高槻駅", minutes: 20 },
    { name: "高槻市駅", minutes: 15 },
  ],
};

describe("resolveYahooPlace（複数の最寄り駅・issue #1607）", () => {
  it("省略時は先頭（優先）の駅名で、駅を外して渡す", () => {
    assert.deepEqual(resolveYahooPlace("自宅", [home]), { name: "高槻", query: "高槻", coordinates: null });
  });
  it("選んだ駅で探す", () => {
    assert.deepEqual(resolveYahooPlace("自宅", [home], "高槻市駅"), {
      name: "高槻市",
      query: "高槻市",
      coordinates: null,
    });
  });
  it("地点で探す（null）は座標と住所", () => {
    assert.deepEqual(resolveYahooPlace("自宅", [home], null), {
      name: "自宅",
      query: "大阪府高槻市出丸町3-36",
      coordinates: { lat: 34.84, lng: 135.61 },
    });
  });
  it("stations を持たない古い値は station を使う", () => {
    const legacy = { ...home, stations: undefined };
    assert.equal(resolveYahooPlace("自宅", [legacy])?.query, "高槻");
  });
});
