import assert from "node:assert/strict";
import test from "node:test";

import { applyDuration, dropGeneratedNote, samePair } from "@/lib/travel-change";
import { GENERATED_NOTE } from "@/lib/work-generated-note";

test("到着固定で所要分を変えると出発が動く", () => {
  const r = applyDuration("arrive", "2026-10-28T21:46:00.000Z", "2026-10-28T22:09:00.000Z", 40);
  assert.equal(r.end, "2026-10-28T22:09:00.000Z");
  assert.equal(r.start, "2026-10-28T21:29:00.000Z");
});

test("出発固定で所要分を変えると到着が動く", () => {
  const r = applyDuration("depart", "2026-10-28T21:46:00.000Z", "2026-10-28T22:09:00.000Z", 10);
  assert.equal(r.start, "2026-10-28T21:46:00.000Z");
  assert.equal(r.end, "2026-10-28T21:56:00.000Z");
});

test("定型メモだけを外す", () => {
  assert.equal(dropGeneratedNote(GENERATED_NOTE), null);
  assert.equal(dropGeneratedNote("自分のメモ"), "自分のメモ");
  assert.equal(dropGeneratedNote(null), null);
});

test("名前だけの設定キーと名前 住所の移動を同じ組として照合する", () => {
  assert.equal(
    samePair(
      { origin: "自宅 大阪府大阪市北区梅田1-1-1", destination: "門真" },
      { origin: "自宅", destination: "門真" },
    ),
    true,
  );
  assert.equal(samePair({ origin: "自宅", destination: "梅田" }, { origin: "自宅", destination: "門真" }), false);
});
