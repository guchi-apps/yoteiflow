import assert from "node:assert/strict";
import test from "node:test";

import { decide, keepSnapshotLocation, type RowState, type Snapshot } from "@/lib/work-sync/decide";

const snap = (start = "2026-10-05T00:00:00.000Z"): Snapshot => ({
  start,
  end: "2026-10-05T08:00:00.000Z",
  title: "勤務",
});
const active = (snapshot = snap()): RowState => ({ status: "ACTIVE", snapshot });

test("控えが無ければ作る・不要なら何もしない", () => {
  assert.equal(decide(snap(), null, null), "create");
  assert.equal(decide(null, null, null), "keep");
});

test("手を入れていなければ変更に追従し、不要なら削除する", () => {
  assert.equal(decide(snap("2026-10-05T01:00:00.000Z"), active(), snap()), "update");
  assert.equal(decide(snap(), active(), snap()), "keep");
  assert.equal(decide(null, active(), snap()), "delete");
});

test("利用者が直した・消した生成物は上書きも削除もしない", () => {
  assert.equal(decide(snap("2026-10-05T01:00:00.000Z"), active(), snap("2026-10-05T02:00:00.000Z")), "markManual");
  assert.equal(decide(snap(), active(), null), "markManual");
  assert.equal(decide(null, active(), snap("2026-10-05T02:00:00.000Z")), "forget");
});

test("手動扱いは以後も触らない", () => {
  const manual: RowState = { status: "MANUAL", snapshot: snap() };
  assert.equal(decide(snap("2026-10-05T01:00:00.000Z"), manual, snap()), "keep");
  assert.equal(decide(null, manual, snap()), "forget");
});

test("勤務予定の場所（issue #1319）: 旧い控え（場所なし）は空の場所と同じに扱い、場所が入るなら更新する", () => {
  const withLocation = { ...snap(), location: "本社 大阪府大阪市1-1" };
  // 旧い控え・Googleの予定とも場所なし → 手を入れていない扱いで、場所を入れる更新になる。
  assert.equal(decide(withLocation, active(), { ...snap(), location: "" }), "update");
  // 利用者がGoogleで場所を直していれば手動扱い。
  assert.equal(decide(withLocation, active(), { ...snap(), location: "カフェ" }), "markManual");
  assert.equal(decide(withLocation, active(withLocation), withLocation), "keep");
});

test("場所DBを読めなかった回は控えの場所を保ち、更新しない（issue #1319）", () => {
  const stored = { ...snap(), location: "本社 大阪府大阪市1-1" };
  const nameOnly = { ...snap(), location: "本社" };
  const expected = keepSnapshotLocation(nameOnly, stored);
  assert.equal(expected.location, "本社 大阪府大阪市1-1");
  assert.equal(decide(expected, active(stored), stored), "keep");
  // 新規（控えなし）は期待値のまま。
  assert.equal(keepSnapshotLocation(nameOnly, null).location, "本社");
});

test("勤務予定のメモ（issue #1446）: 旧い控えはメモなしと同じに扱い、手書きの説明を手動調整と見なさない", () => {
  const withMemo = { ...snap(), description: "午前は設計レビュー" };
  // 旧い控え（説明なし）・Googleの予定も説明なし → 手を入れていない扱いで、メモを入れる更新になる。
  assert.equal(decide(withMemo, active(), { ...snap(), description: "" }), "update");
  // 旧い控えでも、Google側に既にある説明は手動調整と見なさない。
  assert.equal(decide(withMemo, active(), { ...snap(), description: "手書き" }), "update");
  // 控えにメモがあるときは、Googleで直されたら手動扱い。
  assert.equal(decide(withMemo, active(withMemo), { ...snap(), description: "直した" }), "markManual");
  assert.equal(decide(withMemo, active(withMemo), withMemo), "keep");
  // メモを空にしたら更新（消す）。
  assert.equal(decide(snap(), active(withMemo), withMemo), "update");
});

test("移動の交通手段（issue #1453）: 所要時間が同じでも手段だけ変われば更新し、旧い控え（手段なし）は公共交通と同じに扱う", () => {
  const travel = (mode?: string): Snapshot => ({ ...snap(), origin: "自宅", destination: "駅", ...(mode ? { mode } : {}) });
  // 控え・現在とも公共交通 → 期待が車なら更新する。
  assert.equal(decide(travel("CAR"), active(travel("PUBLIC_TRANSIT")), travel("PUBLIC_TRANSIT")), "update");
  assert.equal(decide(travel("CAR"), active(travel("CAR")), travel("CAR")), "keep");
  // 旧い控え（手段なし）は現在の手段を控えとして扱う: 手段が同じなら keep、違えば update、手動調整とは見なさない。
  assert.equal(decide(travel("PUBLIC_TRANSIT"), active(travel()), travel("PUBLIC_TRANSIT")), "keep");
  assert.equal(decide(travel("CAR"), active(travel()), travel("CAR")), "keep");
  assert.equal(decide(travel("CAR"), active(travel()), travel("PUBLIC_TRANSIT")), "update");
  // 旧い控えで期待が無くなれば削除する。
  assert.equal(decide(null, active(travel()), travel("CAR")), "delete");
  // 利用者が手段を直した生成物は手動調整扱い。
  assert.equal(decide(travel("PUBLIC_TRANSIT"), active(travel("PUBLIC_TRANSIT")), travel("WALK")), "markManual");
});
