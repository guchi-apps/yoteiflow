import assert from "node:assert/strict";
import { test } from "node:test";

import { addressCandidates } from "@/lib/work-place-address-candidates";

const place = (id: string, name: string, address: string | null) => ({
  id,
  name,
  address,
  tags: [],
  coordinates: null,
  station: null,
});

test("住所のある場所だけを、住所の重複と対象自身を除いて返す", () => {
  const result = addressCandidates(
    [
      place("1", "本社", "大阪府大阪市北区梅田1-1-1"),
      place("2", "本社ビル", "大阪府大阪市北区梅田1-1-1"),
      place("3", "自宅", null),
      place("4", "別館", "東京都千代田区丸の内1-9-1"),
      place("5", "対象", "東京都港区1-1"),
    ],
    "対象",
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ["1", "4"],
  );
});
