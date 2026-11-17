import assert from "node:assert/strict";
import test from "node:test";

import { splitPlaceForDisplay } from "@/lib/place-text";

test("名前と住所を分ける", () => {
  assert.deepEqual(splitPlaceForDisplay("自宅 〒569-0076 大阪府高槻市xx"), {
    name: "自宅",
    address: "〒569-0076 大阪府高槻市xx",
  });
  assert.deepEqual(splitPlaceForDisplay("ゴリラクリニック 大阪梅田院 大阪府大阪市北区1-1"), {
    name: "ゴリラクリニック 大阪梅田院",
    address: "大阪府大阪市北区1-1",
  });
});

test("住所が読めない値は分けない", () => {
  assert.deepEqual(splitPlaceForDisplay("梅田スカイビル"), { name: "梅田スカイビル", address: "" });
  assert.deepEqual(splitPlaceForDisplay("大阪府大阪市北区1-1"), { name: "大阪府大阪市北区1-1", address: "" });
});
