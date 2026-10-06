import assert from "node:assert/strict";
import test from "node:test";

import type { VerifiedGoogleIdentity } from "@/lib/auth/google-identity";
import {
  linkUser,
  type LinkableUser,
  type LinkedGoogleAccount,
  type LinkUserInput,
  type UserLinkStore,
  type UserProfile,
} from "@/lib/auth/link-user";

type Row = LinkableUser & { name: string | null; image: string | null; settings: string[] };

/** User の一意制約（supabaseUserId・email〔大文字小文字を区別しない〕）を再現したメモリ上の実装。 */
function memoryStore(rows: Row[] = [], accounts: Record<string, LinkedGoogleAccount[]> = {}) {
  const writes: string[] = [];
  const unique = (candidate: { id: string; supabaseUserId: string; email: string | null }) => {
    for (const row of rows) {
      if (row.id === candidate.id) continue;
      const sameEmail =
        row.email !== null &&
        candidate.email !== null &&
        row.email.toLowerCase() === candidate.email.toLowerCase();
      if (row.supabaseUserId === candidate.supabaseUserId || sameEmail) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
    }
  };
  const pick = (row: Row | undefined): LinkableUser | null =>
    row ? { id: row.id, supabaseUserId: row.supabaseUserId, email: row.email } : null;

  const store: UserLinkStore = {
    async findBySupabaseUserId(supabaseUserId) {
      return pick(rows.find((row) => row.supabaseUserId === supabaseUserId));
    },
    async findByEmail(email) {
      return pick(rows.find((row) => row.email?.toLowerCase() === email.toLowerCase()));
    },
    async listGoogleAccounts(userId) {
      return accounts[userId] ?? [];
    },
    async create(supabaseUserId, profile) {
      const row: Row = { id: `new-${rows.length + 1}`, supabaseUserId, ...profile, settings: [] };
      unique(row);
      rows.push(row);
      writes.push(`create:${row.id}`);
      return pick(row)!;
    },
    async updateProfile(userId, profile) {
      const row = rows.find((r) => r.id === userId)!;
      unique({ ...row, ...profile });
      Object.assign(row, profile);
      writes.push(`update:${userId}`);
    },
    async relink(userId, from, to, profile) {
      const row = rows.find((r) => r.id === userId && r.supabaseUserId === from);
      if (!row) return false;
      unique({ ...row, supabaseUserId: to, ...profile });
      Object.assign(row, { supabaseUserId: to, ...profile });
      writes.push(`relink:${userId}`);
      return true;
    },
  };
  return { store, rows, writes };
}

const EMAIL = "someone@gmail.com";
const profile: UserProfile = { email: EMAIL, name: "名前", image: null };

const existingRow = (): Row => ({
  id: "user-1",
  supabaseUserId: "old-auth",
  email: EMAIL,
  name: "名前",
  image: null,
  settings: ["Notion連携", "Calendar連携"],
});

const verified = (overrides: Partial<VerifiedGoogleIdentity> = {}): VerifiedGoogleIdentity => ({
  sub: "1001",
  email: EMAIL,
  emailVerified: true,
  hostedDomain: null,
  ...overrides,
});

function input(store: UserLinkStore, overrides: Partial<LinkUserInput> = {}): LinkUserInput {
  return {
    store,
    authUserId: "new-auth",
    profile,
    googleSubjects: ["1001"],
    verifyGoogle: async () => verified(),
    ...overrides,
  };
}

test("既存の認証IDは従来どおりそのUserでログインし、Googleへ照会しない", async () => {
  const { store, rows } = memoryStore([{ ...existingRow(), supabaseUserId: "new-auth" }]);
  let calls = 0;
  const result = await linkUser(
    input(store, { verifyGoogle: async () => (calls++, verified()) }),
  );
  assert.deepEqual(result, { ok: true, userId: "user-1", outcome: "existing" });
  assert.equal(calls, 0);
  assert.equal(rows.length, 1);
});

test("初めての利用者は新しいUserを作る（Googleへ照会しない）", async () => {
  const { store, rows } = memoryStore();
  const result = await linkUser(
    input(store, { verifyGoogle: async () => assert.fail("照会しない") }),
  );
  assert.equal(result.ok && result.outcome, "created");
  assert.equal(rows.length, 1);
});

test("認証IDが変わってもGoogleで本人と確かめられれば、元のUser IDと設定を保ったまま付け替える", async () => {
  const { store, rows } = memoryStore([existingRow()], {
    "user-1": [{ googleUserId: "1001", email: EMAIL }, { googleUserId: "2002", email: "family@gmail.com" }],
  });
  const result = await linkUser(input(store));
  assert.deepEqual(result, { ok: true, userId: "user-1", outcome: "relinked" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "user-1");
  assert.equal(rows[0].supabaseUserId, "new-auth");
  assert.deepEqual(rows[0].settings, ["Notion連携", "Calendar連携"]);
});

test("メールの大文字小文字が違っても同じ利用者として扱う", async () => {
  const { store, rows } = memoryStore([{ ...existingRow(), email: "Someone@Gmail.com" }]);
  const result = await linkUser(
    input(store, { verifyGoogle: async () => verified({ email: "SOMEONE@gmail.com" }) }),
  );
  assert.equal(result.ok && result.outcome, "relinked");
  assert.equal(rows[0].supabaseUserId, "new-auth");
});

test("Workspaceのドメインは hd が一致するときだけ付け替える", async () => {
  const work = "someone@example.co.jp";
  const row = { ...existingRow(), email: work };
  const ok = memoryStore([{ ...row }]);
  const relinked = await linkUser(
    input(ok.store, {
      profile: { ...profile, email: work },
      verifyGoogle: async () => verified({ email: work, hostedDomain: "example.co.jp" }),
    }),
  );
  assert.equal(relinked.ok && relinked.outcome, "relinked");

  const ng = memoryStore([{ ...row }]);
  const rejected = await linkUser(
    input(ng.store, {
      profile: { ...profile, email: work },
      verifyGoogle: async () => verified({ email: work, hostedDomain: null }),
    }),
  );
  assert.deepEqual(rejected, { ok: false, reason: "not_google_authoritative" });
  assert.equal(ng.rows[0].supabaseUserId, "old-auth");
});

const rejectionCases: [string, Partial<LinkUserInput>, Record<string, LinkedGoogleAccount[]>, string][] = [
  ["Googleがメールを未確認", { verifyGoogle: async () => verified({ emailVerified: false }) }, {}, "email_unverified"],
  [
    "照会したGoogleアカウントがSupabaseの紐付け（identity）と違う",
    { googleSubjects: ["9999"] },
    {},
    "subject_mismatch",
  ],
  [
    "編集可能なメタデータ等でメールを偽っても、Googleが返すメールと違う",
    { verifyGoogle: async () => verified({ email: "attacker@gmail.com" }) },
    {},
    "email_mismatch",
  ],
  [
    "既存UserのCalendar連携に、同じメールで別のGoogleアカウントがある",
    {},
    { "user-1": [{ googleUserId: "7777", email: EMAIL }] },
    "google_account_conflict",
  ],
];

for (const [name, overrides, accounts, reason] of rejectionCases) {
  test(`付け替えない: ${name}`, async () => {
    const { store, rows, writes } = memoryStore([existingRow()], accounts);
    const result = await linkUser(input(store, overrides));
    assert.deepEqual(result, { ok: false, reason });
    assert.equal(rows[0].supabaseUserId, "old-auth");
    assert.deepEqual(writes, []);
  });
}

test("Calendar連携のどれかがログインのGoogleアカウントと一致するだけでは付け替えない", async () => {
  const { store, rows } = memoryStore([existingRow()], { "user-1": [{ googleUserId: "1001", email: EMAIL }] });
  const result = await linkUser(
    input(store, { verifyGoogle: async () => verified({ emailVerified: false }) }),
  );
  assert.equal(result.ok, false);
  assert.equal(rows[0].supabaseUserId, "old-auth");
});

test("Googleへ照会できないときは例外のまま返し、紐付けを変えない", async () => {
  const { store, rows, writes } = memoryStore([existingRow()]);
  await assert.rejects(
    linkUser(input(store, { verifyGoogle: async () => Promise.reject(new Error("timeout")) })),
  );
  assert.equal(rows[0].supabaseUserId, "old-auth");
  assert.deepEqual(writes, []);
});

test("認証IDのUserとは別のUserが同じメールを持つときは、どちらも書き換えない", async () => {
  const { store, rows, writes } = memoryStore([
    existingRow(),
    { ...existingRow(), id: "user-2", supabaseUserId: "new-auth", email: "other@gmail.com" },
  ]);
  const result = await linkUser(input(store));
  assert.deepEqual(result, { ok: false, reason: "email_taken" });
  assert.equal(rows[0].supabaseUserId, "old-auth");
  assert.equal(rows[1].email, "other@gmail.com");
  assert.deepEqual(writes, []);
});

test("同時に2回ログインしても、Userは1つで紐付けも1回だけ変わる", async () => {
  const { store, rows, writes } = memoryStore([existingRow()]);
  const results = await Promise.all([linkUser(input(store)), linkUser(input(store))]);
  assert.ok(results.every((r) => r.ok && r.userId === "user-1"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].supabaseUserId, "new-auth");
  assert.equal(writes.filter((w) => w.startsWith("relink")).length, 1);
});

test("付け替えの直前に別のログインが同じ行を書き換えたら、読み直して既存の紐付けとして扱う", async () => {
  const memory = memoryStore([existingRow()]);
  let raced = false;
  const store: UserLinkStore = {
    ...memory.store,
    async relink(userId, from, to, p) {
      if (!raced) {
        raced = true;
        memory.rows[0].supabaseUserId = to; // 並行したリクエストが先に付け替えた
        return false;
      }
      return memory.store.relink(userId, from, to, p);
    },
  };
  const result = await linkUser(input(store));
  assert.deepEqual(result, { ok: true, userId: "user-1", outcome: "existing" });
  assert.equal(memory.rows.length, 1);
});

test("新規作成が同時に走って一意制約に当たっても、読み直して1つのUserに収まる", async () => {
  const { store, rows } = memoryStore();
  const results = await Promise.all([
    linkUser(input(store, { profile: { ...profile, email: "fresh@gmail.com" } })),
    linkUser(input(store, { profile: { ...profile, email: "fresh@gmail.com" } })),
  ]);
  assert.ok(results.every((r) => r.ok));
  assert.equal(rows.length, 1);
});

test("競合が解けないまま再試行の上限に達したら例外を返す（無限に再試行しない）", async () => {
  const memory = memoryStore();
  let creates = 0;
  const store: UserLinkStore = {
    ...memory.store,
    async create() {
      creates++;
      throw Object.assign(new Error("dup"), { code: "P2002" });
    },
  };
  await assert.rejects(linkUser(input(store)), { code: "P2002" });
  assert.equal(creates, 3);
});
