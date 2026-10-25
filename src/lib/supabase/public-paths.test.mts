import assert from "node:assert/strict";
import test from "node:test";

import { isPublicPath, isTokenAuthApiPath } from "@/lib/supabase/public-paths";

test("iOSアプリの認証引き継ぎ（start・consume）は未ログインでも通す", () => {
  assert.equal(isPublicPath("/auth/native/start"), true);
  assert.equal(isPublicPath("/auth/native/consume"), true);
});

test("似た名前のパスは公開にならない", () => {
  assert.equal(isPublicPath("/auth/nativeX"), false);
  assert.equal(isPublicPath("/auth/nativeX/start"), false);
  assert.equal(isPublicPath("/auth"), false);
});

test("従来の公開パスは変わらない", () => {
  for (const p of ["/login", "/auth/signin", "/auth/callback"]) {
    assert.equal(isPublicPath(p), true);
  }
  assert.equal(isPublicPath("/calendar"), false);
  assert.equal(isPublicPath("/api/google/connect"), false);
});

test("稼働版の照合（/api/app-version）は未ログインでも通す", () => {
  assert.equal(isTokenAuthApiPath("/api/app-version"), true);
  assert.equal(isTokenAuthApiPath("/api/app-version/x"), false);
  assert.equal(isTokenAuthApiPath("/api/app-versions"), false);
  assert.equal(isTokenAuthApiPath("/api/events"), false);
  assert.equal(isTokenAuthApiPath("/api/widget/activity"), true);
});

test("Universal LinkのAASAはSupabaseを通さず未ログインでも返す（issue #1366）", () => {
  assert.equal(isTokenAuthApiPath("/.well-known/apple-app-site-association"), true);
  assert.equal(isTokenAuthApiPath("/.well-known/apple-app-site-association/x"), false);
  assert.equal(isTokenAuthApiPath("/.well-known/other"), false);
  assert.equal(isPublicPath("/.well-known/apple-app-site-association"), false);
});
