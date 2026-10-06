import assert from "node:assert/strict";
import test from "node:test";

import { fetchVerifiedGoogleIdentity, parseGoogleUserinfo } from "@/lib/auth/google-identity";

test("トークンが無ければGoogleへ問い合わせずに失敗する", async () => {
  let called = false;
  await assert.rejects(
    fetchVerifiedGoogleIdentity(null, async () => ((called = true), new Response("{}"))),
  );
  assert.equal(called, false);
});

test("Googleが拒否した（期限切れ・別スコープ）トークンは失敗にする", async () => {
  await assert.rejects(
    fetchVerifiedGoogleIdentity("token", async () => new Response("", { status: 401 })),
    /userinfo_http_401/,
  );
});

test("userinfoの sub・email・email_verified・hd を読む", async () => {
  const identity = await fetchVerifiedGoogleIdentity(
    "token",
    async () =>
      new Response(JSON.stringify({ sub: "1001", email: "a@example.com", email_verified: true, hd: "Example.com" })),
  );
  assert.deepEqual(identity, { sub: "1001", email: "a@example.com", emailVerified: true, hostedDomain: "example.com" });
});

test("email_verified が無い・偽なら未確認として扱う", () => {
  assert.equal(parseGoogleUserinfo({ sub: "1", email: "a@gmail.com" }).emailVerified, false);
  assert.equal(parseGoogleUserinfo({ sub: "1", email: "a@gmail.com", email_verified: "false" }).emailVerified, false);
});

for (const body of [null, {}, { sub: 1001, email: "a@gmail.com" }, { sub: "abc", email: "a@gmail.com" }, { sub: "1", email: "" }]) {
  test(`形の違う応答は拒否する: ${JSON.stringify(body)}`, () => {
    assert.throws(() => parseGoogleUserinfo(body));
  });
}
