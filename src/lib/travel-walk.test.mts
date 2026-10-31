import assert from "node:assert/strict";
import test from "node:test";

import { resolvePlaceWalk } from "@/lib/travel-walk";

const place = (name: string, address = "滋賀県栗東市") =>
  ({ id: name, name, address, coordinates: null, tags: [] }) as never;
const places = [place("栗東"), place("自宅", "大阪府大阪市")];
const rows = [
  { key: "栗東", walkHomeMinutes: 8, walkPlaceMinutes: 12 },
  { key: "大阪", walkHomeMinutes: null, walkPlaceMinutes: null },
];
const fallback = { before: 5, after: 5 };

test("目的地が勤務場所なら、前＝自宅側・後＝勤務先側（#1471）", () => {
  assert.deepEqual(resolvePlaceWalk("自宅 大阪府大阪市", "栗東 滋賀県栗東市", places, rows, fallback), { before: 8, after: 12 });
});

test("出発地が勤務場所なら、前＝勤務先側・後＝自宅側", () => {
  assert.deepEqual(resolvePlaceWalk("栗東", "自宅", places, rows, fallback), { before: 12, after: 8 });
});

test("片方だけ指定なら、空の側は共通値へ落とす", () => {
  const only = [{ key: "栗東", walkHomeMinutes: null, walkPlaceMinutes: 12 }];
  assert.deepEqual(resolvePlaceWalk("自宅", "栗東", places, only, fallback), { before: 5, after: 12 });
});

test("勤務場所に当たらない・両端とも勤務場所・指定が空なら null（共通値のまま）", () => {
  assert.equal(resolvePlaceWalk("自宅", "駅前", places, rows, fallback), null);
  assert.equal(resolvePlaceWalk("栗東", "栗東", places, rows, fallback), null);
  assert.equal(resolvePlaceWalk("自宅", "栗東", places, [{ key: "栗東", walkHomeMinutes: null, walkPlaceMinutes: null }], fallback), null);
});

test("出張扱いの場所は出張の行を引く。同名の通常行の古い値は使わない（#1475）", () => {
  const both = [
    { key: "栗東", isTrip: false, walkHomeMinutes: 1, walkPlaceMinutes: 2 },
    { key: "栗東", isTrip: true, walkHomeMinutes: 8, walkPlaceMinutes: 12 },
  ];
  assert.deepEqual(resolvePlaceWalk("自宅", "栗東", places, both, fallback, ["栗東"]), { before: 8, after: 12 });
  assert.deepEqual(resolvePlaceWalk("自宅", "栗東", places, both, fallback, []), { before: 1, after: 2 });
});

test("今の分類に合う行が無ければ、もう一方の行へ落とさず null（#1475）", () => {
  const staleTrip = [{ key: "栗東", isTrip: true, walkHomeMinutes: 8, walkPlaceMinutes: 12 }];
  assert.equal(resolvePlaceWalk("自宅", "栗東", places, staleTrip, fallback, []), null);
});
