import assert from "node:assert/strict";
import test from "node:test";

import { isGoogleMapsRouteUrl, parseGoogleMapsRouteUrl } from "@/lib/google-maps-route";

test("共有された経路URLから座標・交通手段・指定日時（現地の壁時計）を読む", () => {
  assert.deepEqual(
    parseGoogleMapsRouteUrl(
      "https://www.google.com/maps/dir/34.841753,135.61853/34.552378,135.496285/data=!4m11!8j1791103500!3e0",
    ),
    {
      origin: "34.841753,135.61853",
      destination: "34.552378,135.496285",
      mode: "CAR",
      waypoints: [],
      minutes: null,
      schedule: { basis: "depart", local: "2026-10-04T08:45" },
    },
  );
});

test("Google Maps URLs形式と交通手段を読む", () => {
  assert.deepEqual(
    parseGoogleMapsRouteUrl(
      "https://www.google.com/maps/dir/?api=1&origin=東京駅&destination=新大阪駅&travelmode=transit",
    ),
    { origin: "東京駅", destination: "新大阪駅", mode: "PUBLIC_TRANSIT", waypoints: [], minutes: null, schedule: null },
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
    waypoints: [],
    schedule: null,
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

test("!6e の出発／到着指定と !8j を壁時計として読む（issue #1160）", () => {
  const base = "https://www.google.com/maps/dir/A/B/data=!4m1!2m4!";
  assert.deepEqual(parseGoogleMapsRouteUrl(`${base}6e0!7e2!8j1791382080!11b1!3e0`)?.schedule, { basis: "depart", local: "2026-10-07T14:08" });
  assert.deepEqual(parseGoogleMapsRouteUrl(`${base}6e1!7e2!8j1791549000!11b1!3e0`)?.schedule, { basis: "arrive", local: "2026-10-09T12:30" });
  // 日時の指定が無い・基準が未知の値なら日時は読まない
  assert.equal(parseGoogleMapsRouteUrl(`${base}6e0!7e2!3e0`)?.schedule, null);
  assert.equal(parseGoogleMapsRouteUrl(`${base}6e2!7e2!8j1791382080!3e0`)?.schedule, null);
});

test("経由地のある経路（issue #1197の実URL）は、出発地・経由地・目的地に分ける", () => {
  const route = parseGoogleMapsRouteUrl(
    "https://www.google.com/maps/dir/34.841753,135.61853/%E5%A4%A7%E9%98%AA%E5%BA%9C%E8%8C%A8%E6%9C%A8%E5%B8%82%E9%AB%98%E6%B5%9C%E7%94%BA194%E2%88%92%EF%BC%94/%E3%80%92518-0825+%E4%B8%89%E9%87%8D%E7%9C%8C%E4%BC%8A%E8%B3%80%E5%B8%82%E5%B0%8F%E7%94%B0%E7%94%BA%EF%BC%91%EF%BC%94%EF%BC%95%EF%BC%90%E2%88%92%EF%BC%91/data=!4m23!2m4!6e0!7e2!8j1791541800!11b1!3e0",
  );
  assert.equal(route?.origin, "34.841753,135.61853");
  assert.deepEqual(route?.waypoints, ["大阪府茨木市高浜町194−４"]);
  assert.equal(route?.destination, "〒518-0825 三重県伊賀市小田町１４５０−１");
});

test("経由地が複数あっても順番どおりに読み、上限を超える分は読まない", () => {
  const route = parseGoogleMapsRouteUrl("https://www.google.com/maps/dir/A/B/C/D/data=!3e0");
  assert.deepEqual([route?.origin, route?.waypoints, route?.destination], ["A", ["B", "C"], "D"]);
  const many = parseGoogleMapsRouteUrl("https://www.google.com/maps/dir/a/b/c/d/e/f/g/h/i/data=!3e0");
  assert.equal(many?.waypoints.length, 5);
});

test("2地点の経路は経由地なし", () => {
  assert.deepEqual(parseGoogleMapsRouteUrl("https://www.google.com/maps/dir/A/B/data=!3e0")?.waypoints, []);
});
