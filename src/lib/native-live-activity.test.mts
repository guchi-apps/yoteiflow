import assert from "node:assert/strict";
import test from "node:test";

import { parseNativeLiveActivityStatus } from "@/lib/native-live-activity";

test("想定外の返事は、許可されていない・表示する（既定）として扱う", () => {
  assert.deepEqual(parseNativeLiveActivityStatus(null), {
    supported: false,
    enabled: true,
    error: null,
  });
  assert.equal(parseNativeLiveActivityStatus({ enabled: "no" }).enabled, true);
});

test("オフにした返事を読む", () => {
  assert.deepEqual(parseNativeLiveActivityStatus({ supported: true, enabled: false }), {
    supported: true,
    enabled: false,
    error: null,
  });
});

test("アプリ側の失敗の文を持ち回す", () => {
  const status = parseNativeLiveActivityStatus({
    supported: true,
    enabled: true,
    error: "解除できませんでした。",
  });
  assert.equal(status.error, "解除できませんでした。");
});
