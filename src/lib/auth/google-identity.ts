/**
 * 今回のOAuthで受け取ったGoogleのアクセストークンを、Google自身へ照会して本人を確かめる（issue #1113）。
 *
 * Supabaseの `user_metadata` は利用者が `updateUser()` で書き換えられるため、既存データの
 * 再紐付けの根拠にしない。トークンの持ち主をGoogleのuserinfoで確かめ、不変ID（`sub`）・
 * メール・Googleがそのメールを確認済みか・Workspaceのドメイン（`hd`）だけを返す。
 *
 * 呼ぶのは「認証IDに対応するUserが無く、メールが既存のUserと重なる」ときだけで、
 * 通常のログイン・新規登録ではGoogleへの往復を増やさない。
 */

export type VerifiedGoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  /** Google Workspaceのアカウントなら組織のドメイン。個人のGoogleアカウントは null。 */
  hostedDomain: string | null;
};

export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

const TIMEOUT_MS = 5_000;

export type UserinfoFetcher = (token: string) => Promise<Response>;

const defaultFetcher: UserinfoFetcher = (token) =>
  fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

export class GoogleIdentityError extends Error {}

export async function fetchVerifiedGoogleIdentity(
  token: string | null | undefined,
  fetcher: UserinfoFetcher = defaultFetcher,
): Promise<VerifiedGoogleIdentity> {
  if (!token) throw new GoogleIdentityError("missing_provider_token");
  const response = await fetcher(token);
  if (!response.ok) throw new GoogleIdentityError(`userinfo_http_${response.status}`);
  const body: unknown = await response.json().catch(() => null);
  return parseGoogleUserinfo(body);
}

export function parseGoogleUserinfo(body: unknown): VerifiedGoogleIdentity {
  if (!body || typeof body !== "object") throw new GoogleIdentityError("invalid_userinfo");
  const { sub, email, email_verified: emailVerified, hd } = body as Record<string, unknown>;
  if (typeof sub !== "string" || !/^[0-9]{1,64}$/.test(sub)) {
    throw new GoogleIdentityError("invalid_userinfo");
  }
  if (typeof email !== "string" || !email.includes("@")) {
    throw new GoogleIdentityError("invalid_userinfo");
  }
  return {
    sub,
    email,
    // userinfoは真偽値で返すが、文字列の "true" で返す実装もあるため両方受ける（それ以外は未確認）
    emailVerified: emailVerified === true || emailVerified === "true",
    hostedDomain: typeof hd === "string" && hd ? hd.toLowerCase() : null,
  };
}
