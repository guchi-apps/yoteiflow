import { decideAccess } from "@/lib/access/client";
import { db } from "@/lib/db";

/**
 * DaySpanのユーザーID（`User.id`）が、いまStatusHubの共通アクセス設定で許可されているか。
 *
 * トークン認証（ウィジェット・停止専用トークン）と通知の計画は、Supabaseのセッションを通らないため
 * `getCurrentUser()` の判定が効かない。許可を取り消した利用者がこれらを使い続けないよう、
 * ユーザーIDを引いたあとにここで同じ判定を行う（issue #1179）。結果は ttl の間キャッシュされる。
 */
export async function isUserIdAllowed(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, supabaseUserId: true },
  });
  if (!user || !user.email) return false;

  const decision = await decideAccess({ sub: user.supabaseUserId, email: user.email, emailVerified: true });
  return decision.allowed;
}
