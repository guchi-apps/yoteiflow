import type { UserLinkStore } from "@/lib/auth/link-user";
import { db } from "@/lib/db";

const linkable = { id: true, supabaseUserId: true, email: true } as const;

/** `linkUser()` のPrisma実装。どの書き込みも1文で終わり、途中まで書いた状態を残さない。 */
export const userLinkStore: UserLinkStore = {
  findBySupabaseUserId(supabaseUserId) {
    return db.user.findUnique({ where: { supabaseUserId }, select: linkable });
  },

  // MariaDBの照合順序は大文字小文字を区別しないため、一意制約と同じ基準で引ける
  findByEmail(email) {
    return db.user.findUnique({ where: { email }, select: linkable });
  },

  listGoogleAccounts(userId) {
    return db.googleAccount.findMany({
      where: { userId },
      select: { googleUserId: true, email: true },
    });
  },

  create(supabaseUserId, profile) {
    return db.user.create({
      data: { supabaseUserId, ...profile, uiSetting: { create: {} } },
      select: linkable,
    });
  },

  async updateProfile(userId, profile) {
    await db.user.update({ where: { id: userId }, data: profile });
  },

  async relink(userId, fromSupabaseUserId, toSupabaseUserId, profile) {
    const { count } = await db.user.updateMany({
      where: { id: userId, supabaseUserId: fromSupabaseUserId },
      data: { supabaseUserId: toSupabaseUserId, ...profile },
    });
    return count === 1;
  },
};
