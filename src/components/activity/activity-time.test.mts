import assert from "node:assert/strict";
import { test } from "node:test";

import { invalidStartEdit } from "@/components/activity/activity-time";

test("空は受け付けない", () => {
  assert.notEqual(invalidStartEdit("", "2026-11-01T10:00"), null);
});

test("未来は受け付けない", () => {
  assert.notEqual(invalidStartEdit("2026-11-01T10:01", "2026-11-01T10:00"), null);
});

test("いまと同じ分・過去（記録の開始より前を含む）は受け付ける", () => {
  assert.equal(invalidStartEdit("2026-11-01T10:00", "2026-11-01T10:00"), null);
  assert.equal(invalidStartEdit("2026-10-31T08:00", "2026-11-01T10:00"), null);
});
