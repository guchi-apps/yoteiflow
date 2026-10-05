import assert from "node:assert/strict";
import test from "node:test";

import { handoffLocationText, parseShareHandoff } from "@/lib/share-import/handoff";

test("場所の引き継ぎを検証して読む", () => {
  const handoff = parseShareHandoff("?newEvent=place&title=Tower&address=大阪&lat=34.1&lng=135.2&url=https%3A%2F%2Fmaps.app.goo.gl%2Fx");
  assert.deepEqual(handoff, { kind: "place", title: "Tower", address: "大阪", lat: 34.1, lng: 135.2, url: "https://maps.app.goo.gl/x" });
  assert.equal(handoff && handoff.kind === "place" && handoffLocationText(handoff), "Tower 大阪");
});

test("範囲外の座標・http・長すぎる文字列は捨てる", () => {
  assert.equal(parseShareHandoff("?newEvent=place&lat=99&lng=0"), null);
  const handoff = parseShareHandoff("?newEvent=place&title=A&lat=1&url=http%3A%2F%2Fx");
  assert.ok(handoff && handoff.kind === "place" && handoff.lat === null && handoff.url === null);
  assert.equal(parseShareHandoff(`?newEvent=place&title=${"a".repeat(501)}`), null);
});

test("移動の引き継ぎ", () => {
  assert.deepEqual(parseShareHandoff("?newTravel=1&origin=A&destination=B&mode=WALK&minutes=12"), {
    kind: "travel", origin: "A", destination: "B", mode: "WALK", minutes: 12,
  });
  assert.equal(parseShareHandoff("?newTravel=1&origin=A&destination=B&mode=ROCKET"), null);
  assert.equal(parseShareHandoff("?newTravel=1&origin=A&mode=CAR"), null);
});
