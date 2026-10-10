import assert from "node:assert/strict";
import { test } from "node:test";

import { googleMapsDirectionsLink } from "@/lib/google-maps-directions-link";

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
