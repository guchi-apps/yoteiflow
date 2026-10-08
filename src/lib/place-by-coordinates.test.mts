import assert from "node:assert/strict";
import test from "node:test";

import { placeTextForCoordinates } from "@/lib/place-by-coordinates";
import type { PlaceItem } from "@/services/notion/places";

const place = (name: string, lat: number, lng: number): PlaceItem =>
  ({ id: name, name, address: "大阪府茨木市1-1", coordinates: { lat, lng } }) as unknown as PlaceItem;

test("座標だけの地点は近くの登録済みの場所の名前へ直す", () => {
  const places = [place("会社", 34.7, 135.5), place("自宅", 34.8418, 135.6186)];
  assert.equal(placeTextForCoordinates("34.841753,135.61853", places), "自宅 大阪府茨木市1-1");
});

test("遠い場所・座標でない文字列は直さない", () => {
  assert.equal(placeTextForCoordinates("34.841753,135.61853", [place("会社", 34.7, 135.5)]), null);
  assert.equal(placeTextForCoordinates("自宅", [place("自宅", 34.8, 135.6)]), null);
});
