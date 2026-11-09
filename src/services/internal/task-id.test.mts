import assert from "node:assert/strict";
import test from "node:test";

import { withTaskId } from "@/services/internal/task-id";

test("作成結果にトップレベルのtaskIdを補う（新旧の保存形どちらでも）", () => {
  assert.deepEqual(withTaskId({ task: { id: "abc" } }), { taskId: "abc", task: { id: "abc" } });
  assert.deepEqual(withTaskId({ taskId: "x", task: { id: "abc" } }), { taskId: "x", task: { id: "abc" } });
  assert.equal(withTaskId(null), null);
});
