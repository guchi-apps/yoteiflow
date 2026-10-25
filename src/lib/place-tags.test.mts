import assert from "node:assert/strict";
import test from "node:test";

import { disallowedPlaceTags, PLACE_TAGS } from "@/lib/place-tags";

test("固定の4つは付けられる", () => {
  assert.deepEqual(disallowedPlaceTags([...PLACE_TAGS], []), []);
});

test("固定外の新しいタグは断る", () => {
  assert.deepEqual(disallowedPlaceTags(["家", "友人宅"], []), ["友人宅"]);
});

test("既に付いている旧タグは据え置ける", () => {
  assert.deepEqual(disallowedPlaceTags(["自宅", "仕事"], ["自宅"]), []);
});

test("既に付いていない旧タグは断る", () => {
  assert.deepEqual(disallowedPlaceTags(["勤務先"], ["自宅"]), ["勤務先"]);
});
