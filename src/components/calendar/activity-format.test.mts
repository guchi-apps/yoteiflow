import assert from "node:assert/strict";
import test from "node:test";

import { formatElapsed } from "@/components/calendar/activity-format";

const start = "2026-01-01T00:00:00.000Z";

test("秒つきの経過時間", () => {
  assert.equal(formatElapsed(start, "2026-01-01T00:00:05.000Z", true), "5秒");
  assert.equal(formatElapsed(start, "2026-01-01T00:02:05.000Z", true), "2分5秒");
  assert.equal(formatElapsed(start, "2026-01-01T01:02:05.000Z", true), "1時間2分5秒");
});

test("既定は分まで", () => {
  assert.equal(formatElapsed(start, "2026-01-01T01:02:59.000Z"), "1時間2分");
});
