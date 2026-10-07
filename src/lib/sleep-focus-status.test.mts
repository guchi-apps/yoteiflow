import assert from "node:assert/strict";
import test from "node:test";

import {
  describeSleepFocusCredential,
  describeSleepFocusLast,
  parseSleepFocusStatus,
} from "@/lib/sleep-focus-status";

test("想定外の形は呼び出しなしとして扱う", () => {
  assert.deepEqual(parseSleepFocusStatus(null), { hasToken: false, credential: null, last: null });
  assert.equal(parseSleepFocusStatus({ last: { at: "x", mode: "other", outcome: "succeeded" } }).last, null);
});

test("最後の呼び出しを読み取る", () => {
  const status = parseSleepFocusStatus({
    hasToken: true,
    credential: "saved",
    last: { at: "2026-10-08T01:00:00Z", mode: "start", outcome: "httpError", httpStatus: 401, attempts: 1 },
  });
  assert.equal(status.last?.httpStatus, 401);
  const text = describeSleepFocusLast(status.last!);
  assert.equal(text.ok, false);
  assert.match(text.text, /401/);
  assert.match(text.text, /再ログイン/);
});

test("成功以外は成功として表示しない", () => {
  for (const outcome of ["running", "noToken", "network", "httpError"] as const) {
    const result = describeSleepFocusLast({ at: "x", mode: "stop", outcome, httpStatus: 500, attempts: 3 });
    assert.equal(result.ok, false, outcome);
  }
  assert.equal(describeSleepFocusLast({ at: "x", mode: "stop", outcome: "succeeded", httpStatus: 200, attempts: 1 }).ok, true);
});

test("Keychain保存の失敗とトークン未取得を区別する", () => {
  assert.match(describeSleepFocusCredential({ hasToken: true, credential: "keychainFailed", last: null }) ?? "", /保存できません/);
  assert.match(describeSleepFocusCredential({ hasToken: false, credential: "fetchFailed", last: null }) ?? "", /取得できていません/);
  assert.equal(describeSleepFocusCredential({ hasToken: true, credential: "saved", last: null }), null);
});
