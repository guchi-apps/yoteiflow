import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldApplyEdit } from "@/lib/offline-queue/conflict";
import {
  applyTaskWrites,
  classifyWriteResponse,
  enqueue,
  pendingTaskId,
  rebaseAfterOwnEdit,
  rebindPendingTask,
  type WriteOp,
} from "@/lib/offline-queue/ops";

const base = { queuedAt: "2026-01-01T00:00:00Z" };
const edit = (id: string, taskId: string, patch: object, baseEditedAt: string | null = "2026-01-01T00:00:00Z"): WriteOp =>
  ({ ...base, id, kind: "taskEdit", taskId, patch, baseEditedAt, editedAt: "2026-01-02T00:00:00Z" }) as WriteOp;
const done = (id: string, taskId: string, d: boolean): WriteOp => ({ ...base, id, kind: "taskDone", taskId, done: d });
const create = (clientId: string, input: object): WriteOp =>
  ({ ...base, id: `c-${clientId}`, kind: "taskCreate", clientId, input }) as WriteOp;

test("同じタスクの編集はマージされ、いちばん古い基準を保つ", () => {
  const ops = enqueue(enqueue([], edit("a", "t", { title: "A" }, "2026-01-01T00:00:00Z")), edit("b", "t", { memo: "m" }, "2026-01-01T00:05:00Z"));
  assert.equal(ops.length, 1);
  const op = ops[0];
  assert.equal(op.kind, "taskEdit");
  if (op.kind === "taskEdit") {
    assert.deepEqual(op.patch, { title: "A", memo: "m" });
    assert.equal(op.baseEditedAt, "2026-01-01T00:00:00Z");
  }
});

test("編集と完了切り替えは1つの操作に畳まれる", () => {
  const ops = enqueue(enqueue([], edit("a", "t", { title: "A" })), done("b", "t", true));
  assert.equal(ops.length, 1);
  const op = ops[0];
  assert.equal(op.kind === "taskEdit" && op.patch.done, true);
  const reverse = enqueue(enqueue([], done("b", "t", true)), edit("a", "t", { title: "A" }));
  assert.equal(reverse.length, 1);
  assert.equal(reverse[0].kind, "taskEdit");
});

test("完了だけの重ね押しは従来どおり最後の指定だけ残る", () => {
  const ops = enqueue(enqueue([], done("a", "t", true)), done("b", "t", false));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "taskDone");
});

test("仮タスクへの編集・完了は作成の入力へ畳まれる", () => {
  let ops = enqueue([], create("x", { title: "新規" }));
  ops = enqueue(ops, edit("e", pendingTaskId("x"), { title: "直した" }));
  ops = enqueue(ops, done("d", pendingTaskId("x"), true));
  assert.equal(ops.length, 1);
  const op = ops[0];
  assert.equal(op.kind, "taskCreate");
  if (op.kind === "taskCreate") assert.deepEqual(op.input, { title: "直した", done: true });
});

test("仮タスクは一覧の先頭に出て、編集は表示中のタスクへ重なる", () => {
  const task = {
    kind: "task", id: "t", title: "旧", due: null, hasTime: false, planned: null, plannedHasTime: false,
    done: false, skipped: false, canSkip: false, progress: null, canProgress: false, priority: null,
    tags: [], memo: null, recurrence: null, links: [], url: null,
  } as never;
  const result = applyTaskWrites([task], [create("x", { title: "新規", due: "2026-02-01T10:00" }), edit("e", "t", { title: "新" })]);
  assert.equal(result[0].id, pendingTaskId("x"));
  assert.equal(result[0].hasTime, true);
  assert.equal(result[1].title, "新");
});

test("最終更新が新しい方を採る", () => {
  const edited = "2026-01-02T00:00:30Z";
  // 他の端末の変更が無い（基準から進んでいない）
  assert.equal(shouldApplyEdit({ baseEditedAt: "2026-01-01T00:00:00Z", editedAt: edited, serverLastEditedTime: "2026-01-01T00:00:00Z" }), true);
  // サーバーのほうが新しい
  assert.equal(shouldApplyEdit({ baseEditedAt: "2026-01-01T00:00:00Z", editedAt: edited, serverLastEditedTime: "2026-01-03T00:00:00Z" }), false);
  // 他の端末が先に変えたが、端末の操作のほうが新しい
  assert.equal(shouldApplyEdit({ baseEditedAt: "2026-01-01T00:00:00Z", editedAt: edited, serverLastEditedTime: "2026-01-01T12:00:00Z" }), true);
  // 同じ分の中は端末を優先（Notionは分単位に丸める）
  assert.equal(shouldApplyEdit({ baseEditedAt: "2026-01-01T00:00:00Z", editedAt: edited, serverLastEditedTime: "2026-01-02T00:01:00Z" }), true);
  assert.equal(shouldApplyEdit({ baseEditedAt: "2026-01-01T00:00:00Z", editedAt: edited, serverLastEditedTime: "2026-01-02T00:02:00Z" }), false);
  assert.equal(shouldApplyEdit({ baseEditedAt: null, editedAt: edited, serverLastEditedTime: null }), true);
});

test("stale・作成の確認待ち・実行中の応答の分類", () => {
  assert.equal(classifyWriteResponse(409, { error: "stale", message: "古い" }).type, "discard");
  assert.equal(classifyWriteResponse(409, { error: "operation_in_progress" }).type, "retry");
  assert.equal(classifyWriteResponse(502, { error: "result_unknown", reconciliationRequired: true }).type, "hold");
  assert.equal(classifyWriteResponse(502, { error: "result_unknown" }).type, "retry");
});

test("送信中の編集は後続の編集で書き換えず、別の操作として積む（issue #1247）", () => {
  const sending = { ...edit("a", "t", { title: "A" }), sending: true } as WriteOp;
  const ops = enqueue([sending], edit("b", "t", { memo: "m" }));
  assert.equal(ops.length, 2);
  assert.equal(ops[0].id, "a");
  assert.deepEqual(ops[0].kind === "taskEdit" && ops[0].patch, { title: "A" });
  assert.equal(ops[1].kind === "taskEdit" && ops[1].patch.memo, "m");
});

test("送信中の作成へ後続の編集は畳まず、作成成功後に実IDへ付け替える", () => {
  const sending = { ...create("x", { title: "新規" }), sending: true } as WriteOp;
  let ops = enqueue([sending], edit("e", pendingTaskId("x"), { title: "直した" }));
  assert.equal(ops.length, 2);
  assert.deepEqual(ops[0].kind === "taskCreate" && ops[0].input, { title: "新規" });
  ops = rebindPendingTask(ops.filter((o) => o.id !== sending.id), "x", "real", "2026-02-01T00:00:00Z");
  const op = ops[0];
  assert.equal(op.kind === "taskEdit" && op.taskId, "real");
  assert.equal(op.kind === "taskEdit" && op.baseEditedAt, null);
});

test("自分の編集が届いたあとの後続編集は基準を外し、操作時刻を届いた時刻以降にする", () => {
  const ops = rebaseAfterOwnEdit([edit("b", "t", { memo: "m" })], "t", "2026-02-01T00:00:00Z");
  const op = ops[0];
  assert.equal(op.kind === "taskEdit" && op.baseEditedAt, null);
  assert.equal(op.kind === "taskEdit" && op.editedAt, "2026-02-01T00:00:00Z");
});
