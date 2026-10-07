import assert from "node:assert/strict";
import { test } from "node:test";

import { countNotionActions, type NotionActionInput } from "@/lib/notion-action-needed";

const base: NotionActionInput = {
  taskDataSourceId: "t",
  propertyMap: {
    planned: "a", memo: "a", priority: "a", recurrence: "a", tags: "a", outcome: "a", progress: "a",
  },
  placeDataSourceId: null,
  placePropertyMap: null,
  workDataSourceId: null,
  workPropertyMap: null,
  shoppingDataSourceId: null,
  shoppingPropertyMap: null,
};

test("すべて対応済みなら0", () => {
  assert.equal(countNotionActions(base), 0);
});

test("タスクDB未選択は1件", () => {
  assert.equal(countNotionActions({ ...base, taskDataSourceId: null }), 1);
});

test("任意項目の欠けを数える", () => {
  assert.equal(countNotionActions({ ...base, propertyMap: { planned: "a" } }), 6);
});

test("mapが無いDBは数えない", () => {
  assert.equal(countNotionActions({ ...base, workDataSourceId: "w", workPropertyMap: null }), 0);
});

test("勤務・場所・買い物の欠けを足す", () => {
  const n = countNotionActions({
    ...base,
    placeDataSourceId: "p", placePropertyMap: { name: "n" },
    workDataSourceId: "w", workPropertyMap: { title: "t" },
    shoppingDataSourceId: "s", shoppingPropertyMap: { plannedDate: "d" },
  });
  assert.equal(n, 2 + 6 + 1);
});
