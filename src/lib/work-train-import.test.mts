import { test } from "node:test";
import assert from "node:assert/strict";

import { matchWorkTrainImport, parseWorkTrainTarget, workTrainImportPath, workTrainSearchAt } from "@/lib/work-train-import";

const train = { label: "ＪＲ京都線快速", departMinutes: 396, durationMinutes: 48, note: "詳細" };

test("取り込み待ちは勤務先・出張先の区別・期限が合うときだけ返す", () => {
  const raw = JSON.stringify({ place: "栗東", leg: "out", extra: false, train, expiresAt: 2000 });
  assert.equal(matchWorkTrainImport(raw, "栗東", false, 1000)?.leg, "out");
  assert.equal(matchWorkTrainImport(raw, "門真", false, 1000), null);
  assert.equal(matchWorkTrainImport(raw, "栗東", true, 1000), null);
  assert.equal(matchWorkTrainImport(raw, "栗東", false, 2000), null);
  assert.equal(matchWorkTrainImport("{", "栗東", false, 1000), null);
  const broken = JSON.stringify({ place: "栗東", leg: "out", train: { ...train, durationMinutes: 0 }, expiresAt: 2000 });
  assert.equal(matchWorkTrainImport(broken, "栗東", false, 1000), null);
});

test("下書きの取り込み先を検証する", () => {
  assert.deepEqual(parseWorkTrainTarget({ place: "栗東", leg: "back" }), { place: "栗東", leg: "back", extra: false });
  assert.equal(parseWorkTrainTarget({ place: "栗東", leg: "x" }), null);
  assert.equal(parseWorkTrainTarget(undefined), null);
  assert.equal(workTrainImportPath({ place: "大阪 出張", leg: "out", extra: true }), "/work/places?place=%E5%A4%A7%E9%98%AA%20%E5%87%BA%E5%BC%B5&extra=1");
});

test("探す日時は翌日以降の最初の平日（土日祝を除く）", () => {
  // 2026-11-20 は金曜 → 翌日以降の平日は 11-24（11-23 は勤労感謝の日）
  assert.equal(workTrainSearchAt("2026-11-20", 8 * 60 + 30), "2026-11-24T08:30");
  assert.equal(workTrainSearchAt("2026-11-17", 17 * 60 + 15), "2026-11-18T17:15");
});
