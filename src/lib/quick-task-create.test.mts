import assert from "node:assert/strict";
import test from "node:test";

import { classifyQuickTaskFailure, newQuickTaskClientId } from "@/lib/quick-task-create";

test("作成IDはAPIが受け付ける形（印字可能ASCII・150字以内）で、呼ぶたびに変わる", () => {
  const a = newQuickTaskClientId();
  const b = newQuickTaskClientId();
  assert.match(a, /^[\x21-\x7e]{1,150}$/);
  assert.notEqual(a, b);
});

test("結果未確定（reconciliationRequired）は確認を求め、自動では作り直さない", () => {
  const result = classifyQuickTaskFailure(502, { error: "result_unknown", reconciliationRequired: true }, "保存できませんでした。");
  assert.equal(result.needsConfirmation, true);
});

test("内容を変えた再送（idempotency_key_reused）は確認を求める", () => {
  const result = classifyQuickTaskFailure(409, { error: "idempotency_key_reused" }, "保存できませんでした。");
  assert.equal(result.needsConfirmation, true);
});

test("処理中（operation_in_progress）は同じIDのまま押し直してもらう", () => {
  const result = classifyQuickTaskFailure(409, { error: "operation_in_progress" }, "保存できませんでした。");
  assert.equal(result.needsConfirmation, false);
  assert.match(result.message, /少し待って/);
});

test("それ以外はサーバーの理由（無ければ既定の文言）をそのまま出す", () => {
  assert.deepEqual(classifyQuickTaskFailure(502, { message: "Notionの障害" }, "保存できませんでした。"), {
    message: "Notionの障害",
    needsConfirmation: false,
  });
  assert.deepEqual(classifyQuickTaskFailure(500, null, "保存できませんでした。"), {
    message: "保存できませんでした。",
    needsConfirmation: false,
  });
});
