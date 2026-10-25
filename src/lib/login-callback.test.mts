import assert from "node:assert/strict";
import test from "node:test";

import { resolveInternalPath } from "@/lib/home-path";
import { loginCallbackPath } from "@/lib/login-callback";

test("戻り先にクエリ（日付）を残す（issue #1366）", () => {
  assert.equal(loginCallbackPath("/calendar", "?date=2026-11-09"), "/calendar?date=2026-11-09");
  assert.equal(loginCallbackPath("/calendar", ""), "/calendar");
});

test("ログイン画面を経由しても日付が残る（callbackUrl → next → 戻り先）", () => {
  const login = new URL("/login", "https://dayspan.gucchii.com");
  login.searchParams.set("callbackUrl", loginCallbackPath("/calendar", "?date=2026-11-09&view=day"));
  const next = resolveInternalPath(login.searchParams.get("callbackUrl"));
  const signin = new URL(`/auth/signin?next=${encodeURIComponent(next)}`, "https://dayspan.gucchii.com");
  assert.equal(resolveInternalPath(signin.searchParams.get("next")), "/calendar?date=2026-11-09&view=day");
});

test("外部へ向く形は戻り先にしない", () => {
  assert.equal(loginCallbackPath("//evil.com", ""), "/");
  assert.equal(loginCallbackPath("/\\evil.com", "?a=1"), "/");
  assert.equal(resolveInternalPath(loginCallbackPath("//evil.com", "?date=2026-11-09")), "/");
});
