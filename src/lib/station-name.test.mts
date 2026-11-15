import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureStationSuffix,
  formatStations,
  normalizeStations,
  parseStations,
  yahooSearchStationName,
} from "@/lib/station-name";

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

test("parseStations: 1行1駅と末尾の徒歩分を読む", () => {
  assert.deepEqual(parseStations("高槻駅 20分\n高槻市駅（徒歩15分）\n摂津富田駅"), [
    { name: "高槻駅", minutes: 20 },
    { name: "高槻市駅", minutes: 15 },
    { name: "摂津富田駅", minutes: null },
  ]);
});

test("parseStations: 従来の1駅は数値の列で先頭の分を補う", () => {
  assert.deepEqual(parseStations("高槻市駅", 20), [{ name: "高槻市駅", minutes: 20 }]);
  // 行内の分が正。数値の列は先頭に分が無いときだけ使う
  assert.deepEqual(parseStations("高槻駅 12分", 20), [{ name: "高槻駅", minutes: 12 }]);
  assert.deepEqual(parseStations("高槻駅\n高槻市駅", 20), [
    { name: "高槻駅", minutes: 20 },
    { name: "高槻市駅", minutes: null },
  ]);
});

test("parseStations: 読点区切り・空行・重複・範囲外の分", () => {
  assert.deepEqual(parseStations("高槻駅、高槻市駅,\n\n高槻駅 300分"), [
    { name: "高槻駅", minutes: null },
    { name: "高槻市駅", minutes: null },
  ]);
  assert.deepEqual(parseStations(""), []);
  assert.deepEqual(parseStations(null, 10), []);
});

test("normalizeStations / formatStations: 駅を補い、往復で同じ一覧に戻る", () => {
  const stations = normalizeStations([
    { name: "高槻", minutes: 20 },
    { name: " ", minutes: 5 },
    { name: "高槻駅", minutes: 3 },
    { name: "高槻市", minutes: null },
  ]);
  assert.deepEqual(stations, [
    { name: "高槻駅", minutes: 20 },
    { name: "高槻市駅", minutes: null },
  ]);
  assert.equal(formatStations(stations), "高槻駅 20分\n高槻市駅");
  assert.deepEqual(parseStations(formatStations(stations)), stations);
});
