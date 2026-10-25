import assert from "node:assert/strict";
import test from "node:test";

import {
  matchPlaceByText,
  placeDisplayName,
  splitNameAndAddress,
  toLocationText,
} from "@/lib/place-text";
import type { PlaceItem } from "@/services/notion/places";

function place(overrides: Partial<PlaceItem>): PlaceItem {
  return {
    id: "p1",
    name: "自宅",
    address: null,
    tags: [],
    coordinates: null,
    station: null,
    ...overrides,
  };
}

test("toLocationText: 住所があれば名前へ続ける", () => {
  assert.equal(toLocationText("自宅", "東京都渋谷区渋谷2-21-1"), "自宅 東京都渋谷区渋谷2-21-1");
});

test("toLocationText: 住所が無ければ名前だけ", () => {
  assert.equal(toLocationText("自宅", null), "自宅");
});

test("matchPlaceByText: 名前だけの完全一致", () => {
  const places = [place({ name: "自宅" }), place({ id: "p2", name: "本社" })];
  assert.equal(matchPlaceByText("自宅", places)?.id, "p1");
});

test("matchPlaceByText: `名前 住所`の完全一致", () => {
  const places = [place({ name: "本社", address: "大阪府大阪市北区梅田1-1-1" })];
  const matched = matchPlaceByText("本社 大阪府大阪市北区梅田1-1-1", places);
  assert.equal(matched?.name, "本社");
});

test("matchPlaceByText: 住所が古くなっていても名前の前方一致で拾う（issue #464相当）", () => {
  const places = [place({ name: "本社", address: "旧住所" })];
  const matched = matchPlaceByText("本社 新しい住所", places);
  assert.equal(matched?.name, "本社");
});

test("matchPlaceByText: 区切りの空白まで見て、名前の前方一致だけの誤爆を避ける", () => {
  const places = [place({ name: "自宅" })];
  assert.equal(matchPlaceByText("自宅近くのカフェ 大阪府大阪市", places), null);
});

test("matchPlaceByText: 同じ名前で始まる候補が複数あれば長いほうを採る", () => {
  const places = [place({ name: "本社" }), place({ id: "p2", name: "本社 別館" })];
  const matched = matchPlaceByText("本社 別館 3階", places);
  assert.equal(matched?.id, "p2");
});

test("matchPlaceByText: 当たる候補が無ければnull", () => {
  assert.equal(matchPlaceByText("知らない場所", [place({ name: "自宅" })]), null);
});

test("matchPlaceByText: 空文字はnull", () => {
  assert.equal(matchPlaceByText("", [place({ name: "自宅" })]), null);
});

test("splitNameAndAddress: 先頭以外に現れる最後の都道府県名で分ける", () => {
  assert.deepEqual(splitNameAndAddress("カフェ大阪府庁前 大阪府大阪市北区梅田1-1-1"), {
    name: "カフェ大阪府庁前",
    address: "大阪府大阪市北区梅田1-1-1",
  });
});

test("splitNameAndAddress: 先頭が都道府県名そのものの住所は分けない", () => {
  assert.equal(splitNameAndAddress("東京都新宿区西新宿2-8-1"), null);
});

test("splitNameAndAddress: 都道府県名を含まない値（施設名だけ）はnull", () => {
  assert.equal(splitNameAndAddress("梅田スカイビル"), null);
});

test("splitNameAndAddress: 空文字はnull", () => {
  assert.equal(splitNameAndAddress(""), null);
});

test("placeDisplayName: 住所を切り分けられれば名前だけを返す", () => {
  assert.equal(placeDisplayName("自宅 東京都渋谷区渋谷2-21-1"), "自宅");
});

test("placeDisplayName: 分けられなければそのまま返す", () => {
  assert.equal(placeDisplayName("梅田スカイビル"), "梅田スカイビル");
});

test("placeDisplayName は名前に続く郵便番号も落とす", async () => {
  const { placeDisplayName } = await import("@/lib/place-text");
  assert.equal(placeDisplayName("梅田駅 〒530-0001 大阪府大阪市北区梅田1"), "梅田駅");
  assert.equal(placeDisplayName("梅田駅 5300001 大阪府大阪市北区梅田1"), "梅田駅");
});

test("placeDisplayName は先頭に付く郵便番号の住所だけの値を落とす", () => {
  assert.equal(placeDisplayName("〒100-0001 東京都千代田区千代田１−１"), "東京都千代田区千代田１−１");
  assert.equal(placeDisplayName("東京駅 〒100-0001 東京都千代田区丸の内1"), "東京駅");
});
