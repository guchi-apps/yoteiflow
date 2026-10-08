import assert from "node:assert/strict";
import test from "node:test";

import { travelTitle } from "@/lib/travel-title";
import { normalizeVia, parseVia, serializeVia } from "@/lib/travel-via";

test("経由地の保存と読み戻しは往復し、空は null", () => {
  assert.equal(serializeVia([]), null);
  assert.equal(serializeVia(undefined), null);
  assert.deepEqual(parseVia(serializeVia(["茨木 →駅", "改行\nあり"])), ["茨木 →駅", "改行\nあり"]);
});

test("壊れた保存値・文字列以外は経由なしとして扱う", () => {
  assert.deepEqual(parseVia("{broken"), []);
  assert.deepEqual(parseVia('{"a":1}'), []);
  assert.deepEqual(parseVia(null), []);
  assert.deepEqual(normalizeVia([1, " ", "A", null, "B"]), ["A", "B"]);
});

test("見出しは経由地を挟み、住所は落とす", () => {
  assert.equal(travelTitle({ origin: "自宅", destination: "渋谷" }), "自宅 → 渋谷");
  assert.equal(travelTitle({ origin: "自宅", via: serializeVia(["茨木"]), destination: "渋谷" }), "自宅 → 茨木 → 渋谷");
  assert.equal(travelTitle({ origin: "自宅", via: ["A", "B"], destination: "渋谷" }), "自宅 → A → B → 渋谷");
});
