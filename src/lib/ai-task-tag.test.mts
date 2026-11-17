import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskTagQuestion, NO_MATCH_LABEL, pickTaskTag, shouldAutoPickTag } from "@/lib/ai-task-tag";

test("質問に全タグと逃げ道が入る", () => {
  const q = buildTaskTagQuestion(["仕事", "受け取り"]);
  assert.deepEqual(Object.keys(q.criteria), ["仕事", "受け取り", NO_MATCH_LABEL]);
});

test("一覧内の答えだけ採り、逃げ道・一覧外・nullは採らない", () => {
  const tags = ["仕事", "受け取り"];
  assert.equal(pickTaskTag("受け取り", tags), "受け取り");
  assert.equal(pickTaskTag(NO_MATCH_LABEL, tags), null);
  assert.equal(pickTaskTag("買い物", tags), null);
  assert.equal(pickTaskTag(null, tags), null);
});

test("自動判定は未選択・新しいタイトル・オンラインのときだけ", () => {
  const base = { title: "荷物受け取り", selectedCount: 0, lastAskedTitle: null, tagCount: 3, offline: false };
  assert.equal(shouldAutoPickTag(base), true);
  assert.equal(shouldAutoPickTag({ ...base, title: "  " }), false);
  assert.equal(shouldAutoPickTag({ ...base, selectedCount: 1 }), false);
  assert.equal(shouldAutoPickTag({ ...base, lastAskedTitle: "荷物受け取り" }), false);
  assert.equal(shouldAutoPickTag({ ...base, tagCount: 0 }), false);
  assert.equal(shouldAutoPickTag({ ...base, offline: true }), false);
});
