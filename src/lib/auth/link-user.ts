import type { VerifiedGoogleIdentity } from "@/lib/auth/google-identity";

/**
 * ログインした認証ID（Supabaseのユーザー）をYoteiFlowのUser行へ対応付ける（issue #1113）。
 *
 * 以前は `supabaseUserId` をキーに upsert するだけで、Supabase側の認証IDが変わった利用者
 * （同じメールの既存Userがある）では `User_email_key` の一意制約違反（P2002）で毎回失敗し、
 * ログインできなくなっていた。User行を作り直すと設定・Google/Notion連携・保存済みデータの
 * 所有者（`User.id`）が変わるため、既存の行の `supabaseUserId` だけを付け替える。
 *
 * 付け替えてよいのは次をすべて満たすときだけ（docs/auth-account-recovery.md）。
 * - 今回のOAuthトークンをGoogle自身へ照会でき（`verifyGoogle`）、そのメールをGoogleが確認済み
 * - Googleが照会で返した `sub` が、Supabaseがこの認証IDに結び付けたGoogleのIDと一致
 * - Googleが返したメール・Supabaseのメール・既存Userのメールが一致
 * - そのメールの持ち主をGoogleが決められる（gmail.com／googlemail.com、またはWorkspaceの `hd` と一致）
 * - 既存UserのCalendar連携に、同じメールで別のGoogleアカウント（`googleUserId`）が無い
 *
 * Calendar連携のGoogleアカウントは1人で複数持てる（別人のアカウントを連携していることもある）ため、
 * どれかが一致することは本人の根拠にしない。使うのは「同じメールなのに別のGoogle ID」という矛盾の検出だけ。
 *
 * 書き込みはどれも1行1文で、`relink` は「読んだ時点の旧認証IDのままなら」の条件付き更新にしている。
 * 同時ログイン・再試行で競合したとき（一意制約違反・条件付き更新の空振り）は最初から読み直し、
 * 重複したUserや途中まで書き換えた紐付けを残さない。
 */

export type LinkableUser = {
  id: string;
  supabaseUserId: string;
  email: string | null;
};

export type LinkedGoogleAccount = { googleUserId: string; email: string };

export type UserProfile = { email: string | null; name: string | null; image: string | null };

export type UserLinkStore = {
  findBySupabaseUserId(supabaseUserId: string): Promise<LinkableUser | null>;
  findByEmail(email: string): Promise<LinkableUser | null>;
  listGoogleAccounts(userId: string): Promise<LinkedGoogleAccount[]>;
  /** 新しいUserを作る（UiSettingも一緒に）。一意制約に当たれば例外（P2002）を投げる。 */
  create(supabaseUserId: string, profile: UserProfile): Promise<LinkableUser>;
  updateProfile(userId: string, profile: UserProfile): Promise<void>;
  /** `supabaseUserId` が `fromSupabaseUserId` のままのときだけ付け替える。更新できたらtrue。 */
  relink(
    userId: string,
    fromSupabaseUserId: string,
    toSupabaseUserId: string,
    profile: UserProfile,
  ): Promise<boolean>;
};

export type LinkConflictReason =
  | "email_taken"
  | "email_unverified"
  | "email_mismatch"
  | "subject_mismatch"
  | "not_google_authoritative"
  | "google_account_conflict";

export type LinkUserResult =
  | { ok: true; userId: string; outcome: "existing" | "created" | "relinked" }
  | { ok: false; reason: LinkConflictReason };

export type LinkUserInput = {
  store: UserLinkStore;
  /** Supabaseが検証したセッションのユーザー。 */
  authUserId: string;
  profile: UserProfile;
  /** Supabaseがこの認証IDに結び付けたGoogleのID（identities の provider=google の id）。 */
  googleSubjects: readonly string[];
  /** 必要になったときだけ呼ぶ（往復を増やさない）。失敗は例外のまま呼び出し元へ返す。 */
  verifyGoogle: () => Promise<VerifiedGoogleIdentity>;
  maxAttempts?: number;
};

const DEFAULT_MAX_ATTEMPTS = 3;

/** Googleがメールの持ち主を決められる個人向けドメイン。 */
const GOOGLE_CONSUMER_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

/** 同時実行による競合（一意制約違反・直列化の失敗）か。これだけを読み直して再試行する。 */
export function isRetryableConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const { code } = error as { code: unknown };
  return code === "P2002" || code === "P2034";
}

class RelinkRaceError extends Error {
  readonly code = "P2034";
}

export async function linkUser(input: LinkUserInput): Promise<LinkUserResult> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let verified: VerifiedGoogleIdentity | null = null;
  const verifyOnce = async () => (verified ??= await input.verifyGoogle());

  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptLink(input, verifyOnce);
    } catch (error) {
      if (!isRetryableConflict(error) || attempt >= maxAttempts) throw error;
    }
  }
}

async function attemptLink(
  { store, authUserId, profile, googleSubjects }: LinkUserInput,
  verifyGoogle: () => Promise<VerifiedGoogleIdentity>,
): Promise<LinkUserResult> {
  const email = normalizeEmail(profile.email);
  const linked = await store.findBySupabaseUserId(authUserId);
  const sameEmail = email ? await store.findByEmail(email) : null;

  if (linked) {
    // 認証IDのUserとは別のUserが同じメールを持っている。どちらが本人か決められないため、
    // メールを書き換えず（一意制約違反にもなる）、統合もしない。
    if (sameEmail && sameEmail.id !== linked.id) return { ok: false, reason: "email_taken" };
    await store.updateProfile(linked.id, profile);
    return { ok: true, userId: linked.id, outcome: "existing" };
  }

  if (!sameEmail) {
    const created = await store.create(authUserId, profile);
    return { ok: true, userId: created.id, outcome: "created" };
  }

  // 認証IDが変わった既存利用者の可能性。Googleへ照会した結果で本人と確かめられたときだけ付け替える。
  const conflict = await evaluateRelink(store, sameEmail, email!, googleSubjects, await verifyGoogle());
  if (conflict) return { ok: false, reason: conflict };

  const relinked = await store.relink(sameEmail.id, sameEmail.supabaseUserId, authUserId, profile);
  // 読んでから更新するまでの間に、別のログインが同じ行を書き換えた。読み直してやり直す。
  if (!relinked) throw new RelinkRaceError("relink_race");
  return { ok: true, userId: sameEmail.id, outcome: "relinked" };
}

async function evaluateRelink(
  store: UserLinkStore,
  existing: LinkableUser,
  email: string,
  googleSubjects: readonly string[],
  identity: VerifiedGoogleIdentity,
): Promise<LinkConflictReason | null> {
  if (!identity.emailVerified) return "email_unverified";
  if (!googleSubjects.includes(identity.sub)) return "subject_mismatch";

  const verifiedEmail = normalizeEmail(identity.email);
  if (verifiedEmail !== email || normalizeEmail(existing.email) !== email) return "email_mismatch";

  const domain = emailDomain(email);
  if (!GOOGLE_CONSUMER_DOMAINS.has(domain) && identity.hostedDomain !== domain) {
    return "not_google_authoritative";
  }

  const accounts = await store.listGoogleAccounts(existing.id);
  const contradicts = accounts.some(
    (account) => normalizeEmail(account.email) === email && account.googleUserId !== identity.sub,
  );
  if (contradicts) return "google_account_conflict";

  return null;
}
