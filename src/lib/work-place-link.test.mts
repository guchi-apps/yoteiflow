import assert from "node:assert/strict";
import test from "node:test";

import { shortLabelOf, withWorkPlaceLinks } from "@/lib/work-place-link";
import { matchPlaceByText } from "@/lib/place-text";
import type { PlaceItem } from "@/services/notion/places";

const place = (over: Partial<PlaceItem>): PlaceItem =>
  ({ id: "p", name: "n", address: null, tags: [], coordinates: null, station: null, ...over }) as PlaceItem;

test("別名: 結び付け先の住所を勤務場所の名前で引ける", () => {
  const places = [place({ id: "a", name: "本社ビル", address: "大阪府大阪市北区1-1" })];
  const merged = withWorkPlaceLinks(places, [
    { workPlace: "本社", placeId: "a", shortLabel2: null, shortLabel1: null },
  ]);
  assert.equal(matchPlaceByText("本社", merged)?.address, "大阪府大阪市北区1-1");
  assert.equal(matchPlaceByText("本社ビル", merged)?.id, "a");
});

test("別名: 住所の無い同名の場所があっても結び付け先が優先される", () => {
  const places = [
    place({ id: "empty", name: "本社" }),
    place({ id: "a", name: "本社ビル", address: "大阪府大阪市北区1-1" }),
  ];
  const merged = withWorkPlaceLinks(places, [
    { workPlace: "本社", placeId: "a", shortLabel2: null, shortLabel1: null },
  ]);
  assert.equal(matchPlaceByText("本社", merged)?.address, "大阪府大阪市北区1-1");
  assert.equal(matchPlaceByText("本社 大阪府大阪市北区1-1", merged)?.id, "a");
});

test("別名: 結び付け先が無い・未設定なら変えない", () => {
  const places = [place({ id: "a", name: "本社ビル" })];
  const links = [
    { workPlace: "本社", placeId: "gone", shortLabel2: null, shortLabel1: null },
    { workPlace: "支社", placeId: null, shortLabel2: "支", shortLabel1: "支" },
  ];
  assert.equal(withWorkPlaceLinks(places, links), places);
});

test("省略名: 空白だけは未設定", () => {
  const link = { shortLabel2: "本社", shortLabel1: " " };
  assert.equal(shortLabelOf(link, 2), "本社");
  assert.equal(shortLabelOf(link, 1), null);
  assert.equal(shortLabelOf(undefined, 2), null);
});
