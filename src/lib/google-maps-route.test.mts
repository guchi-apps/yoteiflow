import assert from "node:assert/strict";
import test from "node:test";

import { isGoogleMapsRouteUrl, parseGoogleMapsRouteUrl } from "@/lib/google-maps-route";

test("共有された経路URLから座標・交通手段・出発日時を読む", () => {
  assert.deepEqual(
    parseGoogleMapsRouteUrl(
      "https://www.google.com/maps/dir/34.841753,135.61853/34.552378,135.496285/data=!4m11!8j1791103500!3e0",
    ),
    {
      origin: "34.841753,135.61853",
      destination: "34.552378,135.496285",
      mode: "CAR",
      minutes: null,
      departAt: "2026-10-04T08:45:00.000Z",
    },
  );
});

test("Google Maps URLs形式と交通手段を読む", () => {
  assert.deepEqual(
    parseGoogleMapsRouteUrl(
      "https://www.google.com/maps/dir/?api=1&origin=東京駅&destination=新大阪駅&travelmode=transit",
    ),
    { origin: "東京駅", destination: "新大阪駅", mode: "PUBLIC_TRANSIT", minutes: null, departAt: null },
  );
});

test("Google以外・経路でないURLは読まない", () => {
  assert.equal(parseGoogleMapsRouteUrl("https://example.com/maps/dir/a/b"), null);
  assert.equal(parseGoogleMapsRouteUrl("https://www.google.com/maps/search/東京駅"), null);
  assert.equal(parseGoogleMapsRouteUrl("not a url"), null);
});

// iOSの経路共有の短縮URLが展開される旧形式（issue #1142）。地点は匿名化している
const legacyRoute =
  "https://maps.google.com/?geocode=FZqjEwId818VCA%3D%3D;FQi8EwId&daddr=%E3%80%92100-0001+%E6%9D%B1%E4%BA%AC%E9%83%BD%E5%8D%83%E4%BB%A3%E7%94%B0%E5%8C%BA%E5%8D%83%E4%BB%A3%E7%94%B0%EF%BC%91%E2%88%92%EF%BC%91&saddr=35.6812360,139.7671250&dirflg=d&ftid=0x0:0x0&g_st=ic";

test("saddr・daddr・dirflg 形式を経路として読み、座標だけの出発地も残す", () => {
  assert.deepEqual(parseGoogleMapsRouteUrl(legacyRoute), {
    origin: "35.6812360,139.7671250",
    destination: "〒100-0001 東京都千代田区千代田１−１",
    mode: "CAR",
    minutes: null,
    departAt: null,
  });
  assert.equal(isGoogleMapsRouteUrl(legacyRoute), true);
});

test("dirflg の移動手段を区分へ対応付ける", () => {
  const base = "https://maps.google.com/?saddr=A&daddr=B&dirflg=";
  assert.equal(parseGoogleMapsRouteUrl(`${base}r`)?.mode, "PUBLIC_TRANSIT");
  assert.equal(parseGoogleMapsRouteUrl(`${base}w`)?.mode, "WALK");
  assert.equal(parseGoogleMapsRouteUrl(`${base}b`)?.mode, "OTHER");
  assert.equal(parseGoogleMapsRouteUrl("https://maps.google.com/?saddr=A&daddr=B")?.mode, "CAR");
});

test("目的地だけの経路は経路として読めないが、経路URLとして判別する", () => {
  const onlyDestination = "https://maps.google.com/?daddr=B&dirflg=d";
  assert.equal(parseGoogleMapsRouteUrl(onlyDestination), null);
  assert.equal(isGoogleMapsRouteUrl(onlyDestination), true);
  assert.equal(isGoogleMapsRouteUrl("https://www.google.com/maps/place/Tower/@34.1,135.1,17z"), false);
});
