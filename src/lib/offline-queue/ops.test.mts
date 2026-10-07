import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyBoughtOps,
  applyTaskOps,
  classifyWriteResponse,
  enqueue,
  nextSendable,
  planWorkToday,
  type WriteOp,
} from "@/lib/offline-queue/ops";

const base = { id: "1", queuedAt: "2026-01-01T00:00:00Z" };
const bought = (id: string, itemId: string, b: boolean): WriteOp => ({ ...base, id, kind: "shoppingBought", itemId, bought: b });

test("同じ対象の操作は後に積んだものだけが残る", () => {
  const ops = enqueue(enqueue([], bought("a", "x", true)), bought("b", "x", false));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].id, "b");
});

test("別の対象の操作は並んで残り、順序を守る", () => {
  const ops = enqueue(enqueue([], bought("a", "x", true)), bought("b", "y", true));
  assert.deepEqual(ops.map((o) => o.id), ["a", "b"]);
});

test("応答の分類", () => {
  assert.equal(classifyWriteResponse(200, null).type, "done");
  assert.equal(classifyWriteResponse(404, null).type, "done");
  assert.deepEqual(classifyWriteResponse(401, null), { type: "retry", authRequired: true });
  assert.deepEqual(classifyWriteResponse(503, null), { type: "retry" });
  assert.deepEqual(classifyWriteResponse(409, { message: "重なり" }), { type: "hold", message: "重なり" });
});

test("保留中の先頭があると次を送らない", () => {
  assert.equal(nextSendable([{ ...bought("a", "x", true), heldReason: "x" }]), null);
  assert.equal(nextSendable([])?.id, undefined);
});

test("購入済み・タスクの完了へ未送信の操作を重ねる", () => {
  const items = applyBoughtOps([{ id: "x", bought: false }, { id: "y", bought: false }], [bought("a", "x", true)]);
  assert.deepEqual(items.map((i) => i.bought), [true, false]);
  const tasks = applyTaskOps(
    [{ id: "t", done: false, skipped: true }],
    [{ ...base, kind: "taskDone", taskId: "t", done: true }],
  );
  assert.deepEqual(tasks[0], { id: "t", done: true, skipped: false });
});

test("勤務の送信時の分岐", () => {
  assert.deepEqual(planWorkToday(null, "在宅"), { action: "post" });
  assert.deepEqual(planWorkToday({ id: "r", place: "在宅" }, "在宅"), { action: "none" });
  assert.deepEqual(planWorkToday({ id: "r", place: "出社" }, "在宅"), { action: "patch", id: "r" });
  assert.deepEqual(planWorkToday({ id: "r", place: "在宅" }, null), { action: "delete", id: "r" });
  assert.deepEqual(planWorkToday(null, null), { action: "none" });
  assert.deepEqual(planWorkToday({ id: "r", place: null, annualLeave: true }, "在宅"), { action: "none" });
});
