import assert from "node:assert/strict";
import test from "node:test";

import { parseGoogleMapsPlaceUrl } from "@/lib/google-maps-place";

test("place URLから名前・ピンの座標を読む（ピンを表示中心より優先）", () => {
  const place = parseGoogleMapsPlaceUrl(
    "https://www.google.com/maps/place/%E5%A4%A7%E9%98%AA%E5%9F%8E/@34.6873,135.5262,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d34.687315!4d135.526201",
  );
  assert.deepEqual(place, { name: "大阪城", address: null, coordinates: { lat: 34.687315, lng: 135.526201 } });
});

test("名前, 住所 の形は分ける", () => {
  const place = parseGoogleMapsPlaceUrl("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("カフェ, 大阪府大阪市1-1"));
  assert.equal(place?.name, "カフェ");
  assert.equal(place?.address, "大阪府大阪市1-1");
});

test("座標だけのqは名前にしない", () => {
  assert.deepEqual(parseGoogleMapsPlaceUrl("https://maps.google.com/?q=34.5,135.5"), {
    name: null,
    address: null,
    coordinates: { lat: 34.5, lng: 135.5 },
  });
});

test("経路・Google以外・範囲外の座標は読まない", () => {
  assert.equal(parseGoogleMapsPlaceUrl("https://www.google.com/maps/dir/東京駅/大阪駅"), null);
  assert.equal(parseGoogleMapsPlaceUrl("https://evil.example/maps/place/x"), null);
  assert.equal(parseGoogleMapsPlaceUrl("https://maps.google.com/?q=99,200"), null);
});
