import assert from "node:assert/strict";
import test from "node:test";

import { mergePlaceCandidates, type PlaceCandidate } from "@/lib/place-candidates";

const c = (name: string, address: string | null, source: "map" | "ai" = "map"): PlaceCandidate => ({
  name,
  address,
  coordinates: null,
  source,
});

test("同じ名前・住所は先のものだけ残す", () => {
  const merged = mergePlaceCandidates([[c("A", "大阪")], [c(" A ", "大 阪", "ai")]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "map");
});

test("住所の無い候補と同名の住所付きは重複として扱わない（住所付きが先ならそちらだけ）", () => {
  assert.equal(mergePlaceCandidates([[c("A", "大阪")], [c("A", null, "ai")]]).length, 1);
});

test("空の名前は除き、件数を上限で切る", () => {
  const list = Array.from({ length: 8 }, (_, i) => c(`P${i}`, null));
  assert.equal(mergePlaceCandidates([[c("", null)], list], 5).length, 5);
});
