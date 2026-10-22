import assert from "node:assert/strict";
import test from "node:test";

import { hasPlaceAddress, locationIssue } from "@/lib/location-check";
import type { PlaceItem } from "@/services/notion/places";

function place(overrides: Partial<PlaceItem>): PlaceItem {
  return { id: "p1", name: "本社", address: null, tags: [], coordinates: null, station: null, ...overrides };
}

const timed = { allDay: false, readOnly: false };

test("locationIssue: 場所が空なら missing", () => {
  assert.equal(locationIssue({ ...timed, location: null }, []), "missing");
  assert.equal(locationIssue({ ...timed, location: "  " }, []), "missing");
});

test("locationIssue: 名前だけで場所DBにも無ければ no_address", () => {
  assert.equal(locationIssue({ ...timed, location: "本社" }, []), "no_address");
  assert.equal(locationIssue({ ...timed, location: "本社" }, [place({})]), "no_address");
});

test("locationIssue: 場所DBに住所付きで当たれば問題なし", () => {
  const places = [place({ address: "大阪府大阪市北区梅田3-1-3" })];
  assert.equal(locationIssue({ ...timed, location: "本社" }, places), null);
});

test("locationIssue: 地点だけ登録された場所も問題なし", () => {
  const places = [place({ coordinates: { lat: 34.7, lng: 135.5 } })];
  assert.equal(locationIssue({ ...timed, location: "本社" }, places), null);
});

test("locationIssue: 文字に住所が含まれていれば問題なし", () => {
  assert.equal(locationIssue({ ...timed, location: "本社 大阪府大阪市北区梅田3-1-3" }, []), null);
  assert.equal(locationIssue({ ...timed, location: "東京都渋谷区渋谷2-21-1" }, []), null);
});

test("locationIssue: 対象外（終日・読み取り専用・活動記録・URL）", () => {
  assert.equal(locationIssue({ allDay: true, readOnly: false, location: null }, []), null);
  assert.equal(locationIssue({ allDay: false, readOnly: true, location: null }, []), null);
  assert.equal(locationIssue({ ...timed, location: null }, [], { isActivity: true }), null);
  assert.equal(locationIssue({ ...timed, location: "https://meet.google.com/abc" }, []), null);
});

test("hasPlaceAddress: 住所の空白だけは住所なし", () => {
  assert.equal(hasPlaceAddress("本社", [place({ address: " " })]), false);
});
