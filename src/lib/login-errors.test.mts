import assert from "node:assert/strict";
import test from "node:test";

import { isLoginError, SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";
import { NATIVE_LOGIN_ERRORS } from "@/lib/native-auth/native-app";

test("iOSアプリから渡る失敗の種類は、すべてログイン画面が案内できる", () => {
  for (const error of NATIVE_LOGIN_ERRORS) assert.ok(isLoginError(error), error);
});

test("保護ページからの差し戻し先は、ログイン済みでも起動画面へ戻されない値を持つ", () => {
  const error = new URL(SESSION_UNLINKED_LOGIN_PATH, "https://example.com").searchParams.get("error");
  assert.ok(isLoginError(error));
});

test("知らない値・プロトタイプのキーは失敗の種類として扱わない", () => {
  for (const value of [null, undefined, "", "toString", "__proto__", "unknown"]) {
    assert.equal(isLoginError(value), false);
  }
});
