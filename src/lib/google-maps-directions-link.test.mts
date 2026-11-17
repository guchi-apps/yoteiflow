import assert from "node:assert/strict";
import { test } from "node:test";

import { googleMapsDirectionsLink } from "@/lib/google-maps-directions-link";
import { parseGoogleMapsRouteUrl } from "@/lib/google-maps-route";

const home = { name: "自宅", address: "大阪府豊中市中桜塚3-1-1", coordinates: { lat: 34.78, lng: 135.47 } };

test("場所DBに当たる出発地は座標、目的地は文字列で渡す", () => {
  const url = googleMapsDirectionsLink({
    origin: "自宅 大阪府豊中市中桜塚3-1-1",
    destination: "大阪駅",
    mode: "PUBLIC_TRANSIT",
    places: [home as never],
  });
  assert.equal(
    url,
    "https://www.google.com/maps/dir/?api=1&destination=%E5%A4%A7%E9%98%AA%E9%A7%85&origin=34.78%2C135.47&travelmode=transit",
  );
});

test("出発地が空ならoriginを付けず、目的地が空ならnull", () => {
  const url = googleMapsDirectionsLink({ origin: "", destination: "大阪駅", mode: "OTHER", places: [] });
  assert.ok(url && !url.includes("origin=") && !url.includes("travelmode="));
  assert.equal(googleMapsDirectionsLink({ origin: "自宅", destination: " ", mode: "CAR", places: [] }), null);
});

test("経由地はwaypointsにまとめる", () => {
  const url = googleMapsDirectionsLink({ origin: "A", destination: "B", via: ["C", "D"], mode: "CAR", places: [] });
  assert.ok(url?.includes("waypoints=C%7CD"));
  assert.ok(url?.includes("travelmode=driving"));
});

test("日時つきは共有URLと同じdata形式で、読み取り側と往復する（出発・車）", () => {
  const url = googleMapsDirectionsLink({
    origin: "A駅",
    destination: "B駅",
    mode: "CAR",
    places: [],
    schedule: { at: "2026-11-20T09:05", basis: "depart" },
  });
  assert.ok(url?.startsWith("https://www.google.com/maps/dir/"));
  assert.ok(url?.includes("!6e0!7e2!8j1795165500!3e0"));
  const route = parseGoogleMapsRouteUrl(url ?? "");
  assert.deepEqual(route?.schedule, { basis: "depart", local: "2026-11-20T09:05" });
  assert.equal(route?.mode, "CAR");
  assert.equal(route?.origin, "A駅");
  assert.equal(route?.destination, "B駅");
});

test("到着基準・徒歩・経由地・日本語のエンコード", () => {
  const url = googleMapsDirectionsLink({
    origin: "自宅",
    destination: "大阪駅",
    via: ["C"],
    mode: "WALK",
    places: [],
    schedule: { at: "2026-11-20T18:30", basis: "arrive" },
  });
  const route = parseGoogleMapsRouteUrl(url ?? "");
  assert.deepEqual(route?.schedule, { basis: "arrive", local: "2026-11-20T18:30" });
  assert.equal(route?.mode, "WALK");
  assert.deepEqual(route?.waypoints, ["C"]);
  assert.equal(route?.destination, "大阪駅");
});

test("日時つきでも出発地が空なら空セグメント、その他は!3eを付けない、日時が不正なら従来のURL", () => {
  const url = googleMapsDirectionsLink({
    origin: "",
    destination: "B",
    mode: "OTHER",
    places: [],
    schedule: { at: "2026-11-20T09:00", basis: "depart" },
  });
  assert.ok(url?.startsWith("https://www.google.com/maps/dir//B/data="));
  assert.ok(url && !url.includes("!3e"));
  const fallback = googleMapsDirectionsLink({
    origin: "A",
    destination: "B",
    mode: "CAR",
    places: [],
    schedule: { at: "bad", basis: "depart" },
  });
  assert.ok(fallback?.includes("api=1"));
});
