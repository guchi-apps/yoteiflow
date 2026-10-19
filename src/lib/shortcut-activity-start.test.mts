import assert from "node:assert/strict";
import test from "node:test";

import { decideControlStart, parseStartPresetId } from "@/lib/shortcut-activity-start";

test("presetId を取り出す", () => {
  assert.equal(parseStartPresetId({ presetId: "cm123" }), "cm123");
  assert.equal(parseStartPresetId({ presetId: "  cm123 " }), "cm123");
});

test("不正な本文は null", () => {
  assert.equal(parseStartPresetId(null), null);
  assert.equal(parseStartPresetId("cm123"), null);
  assert.equal(parseStartPresetId({}), null);
  assert.equal(parseStartPresetId({ presetId: 1 }), null);
  assert.equal(parseStartPresetId({ presetId: "   " }), null);
  assert.equal(parseStartPresetId({ presetId: "a".repeat(65) }), null);
});

test("同じ項目を記録中なら始め直さない", () => {
  assert.equal(decideControlStart("仕事", "仕事"), "not_changed");
  assert.equal(decideControlStart("睡眠", "仕事"), "start");
  assert.equal(decideControlStart(null, "仕事"), "start");
});
