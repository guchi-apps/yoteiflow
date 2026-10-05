import assert from "node:assert/strict";
import test from "node:test";

import { decide, type RowState, type Snapshot } from "@/lib/work-sync/decide";

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
