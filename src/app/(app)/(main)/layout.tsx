import type { ReactNode } from "react";

import { MainShell } from "@/components/nav/main-shell";

/**
 * 下部ナビから開く5画面（カレンダー・タスク・記録・勤務・買い物）の共通レイアウト（issue #1395）。
 *
 * ヘッダーの枠・下部ナビ・記録中バーはここで1度だけ描き、画面を移っても作り直さない。
 * サイドバーと記録中の状態は上の `(app)` レイアウト（`AppShell`）が持つ。
 * 睡眠（`/activity/sleep`）と年休（`/work/leave`）は戻るボタン付きの別の骨格を使うため、
 * このグループの外に置いている。
 */
export default function MainLayout({ children }: { children: ReactNode }) {
  return <MainShell>{children}</MainShell>;
}
