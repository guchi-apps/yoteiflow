import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { MainShell } from "@/components/nav/main-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";
import { getRunningActivity } from "@/services/activity/running";

/**
 * 下部ナビから開く5画面（カレンダー・タスク・記録・勤務・買い物）の共通レイアウト（issue #1395）。
 *
 * サイドバー・ヘッダーの枠・下部ナビ・記録中バーはここで1度だけ描き、画面を移っても作り直さない。
 * 睡眠（`/activity/sleep`）と年休（`/work/leave`）は戻るボタン付きの別の骨格を使うため、
 * このグループの外に置いている。
 */
export default async function MainLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const [uiSetting, running] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId: user.id }, select: { timeZone: true } }),
    // ナビの記録の項目の印・記録中バー・サイドバーのカードに使う（docs/spec.md §27）。
    // DaySpanのDBだけで完結するため、外部APIの往復は増えない。
    getRunningActivity(user.id),
  ]);

  return (
    <MainShell initialRunning={running} timeZone={uiSetting?.timeZone ?? "Asia/Tokyo"}>
      {children}
    </MainShell>
  );
}
