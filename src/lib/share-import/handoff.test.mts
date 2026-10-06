import assert from "node:assert/strict";
import test from "node:test";

import { handoffLocationText, linkedTravelTimes, parseShareHandoff } from "@/lib/share-import/handoff";

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
    kind: "travel", origin: "A", destination: "B", mode: "WALK", minutes: 12, link: null,
  });
  assert.equal(parseShareHandoff("?newTravel=1&origin=A&destination=B&mode=ROCKET"), null);
  assert.equal(parseShareHandoff("?newTravel=1&origin=A&mode=CAR"), null);
});

test("link=1 は発着時刻が揃っているときだけ紐づけ導線になる", () => {
  const base = "?newTravel=1&origin=A&destination=B&mode=PUBLIC_TRANSIT&minutes=30";
  const ok = parseShareHandoff(`${base}&link=1&departAt=2026-10-06T00:00:00.000Z&arriveAt=2026-10-06T00:30:00.000Z`);
  assert.deepEqual(ok?.kind === "travel" && ok.link, {
    departAt: "2026-10-06T00:00:00.000Z",
    arriveAt: "2026-10-06T00:30:00.000Z",
  });
  const noLink = parseShareHandoff(`${base}&departAt=2026-10-06T00:00:00.000Z&arriveAt=2026-10-06T00:30:00.000Z`);
  assert.equal(noLink?.kind === "travel" && noLink.link, null);
  const reversed = parseShareHandoff(`${base}&link=1&departAt=2026-10-06T01:00:00.000Z&arriveAt=2026-10-06T00:30:00.000Z`);
  assert.equal(reversed?.kind === "travel" && reversed.link, null);
  const missing = parseShareHandoff(`${base}&link=1&departAt=bad`);
  assert.equal(missing?.kind === "travel" && missing.link, null);
});

test("紐づけ先の予定の日へ到着日を寄せ、所要時間ぶん遡る", () => {
  assert.deepEqual(linkedTravelTimes("2026-10-10T09:00", "2026-10-06T08:20", "2026-10-06T08:50"), {
    departAt: "2026-10-10T08:20",
    arriveAt: "2026-10-10T08:50",
  });
  // 日をまたぐ経路は出発が前日になる
  assert.deepEqual(linkedTravelTimes("2026-10-10T01:00", "2026-10-06T23:40", "2026-10-07T00:20"), {
    departAt: "2026-10-09T23:40",
    arriveAt: "2026-10-10T00:20",
  });
});
