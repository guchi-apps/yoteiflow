import assert from "node:assert/strict";
import { test } from "node:test";

import { filterPlaces } from "@/lib/place-filter";

const places = [
  { name: "スタバ梅田", address: "大阪府大阪市北区", station: "梅田駅", tags: ["カフェ", "駅近"] },
  { name: "本社", address: "大阪府大阪市中央区", station: null, tags: ["職場"] },
  { name: "実家", address: null, station: null, tags: [] },
];

test("条件が無ければ元の配列をそのまま返す", () => {
  assert.equal(filterPlaces(places, "  ", []), places);
});

test("タグは複数選ぶと いずれか を残す", () => {
  const names = filterPlaces(places, "", ["カフェ", "職場"]).map((p) => p.name);
  assert.deepEqual(names, ["スタバ梅田", "本社"]);
});

test("検索語とタグは掛け合わせる", () => {
  assert.deepEqual(filterPlaces(places, "梅田", ["職場"]), []);
  assert.deepEqual(
    filterPlaces(places, "梅田", ["駅近"]).map((p) => p.name),
    ["スタバ梅田"],
  );
});

test("タグを持たない場所はタグ選択中は出ない", () => {
  assert.deepEqual(filterPlaces(places, "", ["カフェ"]).map((p) => p.name), ["スタバ梅田"]);
});

test("検索語は最寄り駅にも当たる", () => {
  assert.deepEqual(filterPlaces(places, "梅田駅", []).map((p) => p.name), ["スタバ梅田"]);
});
