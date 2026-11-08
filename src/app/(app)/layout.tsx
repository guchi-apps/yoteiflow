import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/nav/app-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";
import { getRunningActivity } from "@/services/activity/running";

/**
 * ログイン後の全画面（下部ナビの5画面・睡眠・日付・場所・設定・年休）の共通レイアウト（issue #1499）。
 *
 * 左のサイドバーと記録中の状態はここで1度だけ描き、画面を移っても作り直さない。
 * 以前は5画面（`(main)`）と戻るボタン付きだった画面が別々の階層でサイドバーを持っていたため、
 * 階層をまたぐ移動のたびにサイドバーが作り直され、再取得も走っていた。
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const [uiSetting, running] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId: user.id }, select: { timeZone: true } }),
    // ナビの記録の項目の印・記録中バー・サイドバーのカードに使う（docs/spec.md §27）。
    // DaySpanのDBだけで完結するため、外部APIの往復は増えない。
    getRunningActivity(user.id),
  ]);

  return (
    <AppShell initialRunning={running} timeZone={uiSetting?.timeZone ?? "Asia/Tokyo"}>
      {children}
    </AppShell>
  );
}
