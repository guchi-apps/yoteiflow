import Link from "next/link";
import { redirect } from "next/navigation";
import { Timer } from "lucide-react";

import { ActivityScreen } from "@/components/activity/activity-screen";
import { AppMenuButton } from "@/components/nav/app-drawer";
import { AppFrame } from "@/components/nav/app-frame";
import { BottomNav } from "@/components/nav/main-nav";
import { AppBadgeSync } from "@/components/notifications/app-badge-sync";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { listActivityPresets } from "@/services/activity/presets";
import { getRunningActivity } from "@/services/activity/running";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

export default async function ActivityPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  // 記録はDaySpanのDBだけで完結する。外部APIには触れないため、開くのに待ち時間は入らない。
  // 保存先の有無はカレンダー設定の行数で見る（Googleへ問い合わせると、押すまでに間が空く）。
  const [presets, running, calendarCount, uiSetting] = await Promise.all([
    listActivityPresets(user.id),
    getRunningActivity(user.id),
    db.calendarSetting.count({ where: { userId: user.id, writeEnabled: true } }),
    db.uiSetting.findUnique({ where: { userId: user.id } }),
  ]);

  // 保存先が無いと、止めた記録を予定にできない。押せてしまう前に接続へ誘導する。
  // ただし記録中は画面を出す。記録の途中で保存先の「使用」を全部オフにされたときに
  // ここで止めると、止めることも取り消すこともできない記録が残り続ける。
  if (calendarCount === 0 && !running) return <ConnectPrompt />;

  return (
    <>
      {/* アプリの起点になる画面（docs/spec.md §26）。ここでバッジを合わせておかないと、
          記録だけを開いて閉じる使い方では件数がいつまでも古いままになる。 */}
      <AppBadgeSync />
      <ActivityScreen
        presets={presets}
        initialRunning={running}
        timeZone={uiSetting?.timeZone ?? "Asia/Tokyo"}
      />
    </>
  );
}

function ConnectPrompt() {
  return (
    // 未接続でも画面を移れるよう、他の記録画面と同じ枠（1024px以上のサイドバー・それ未満のメニュー
    // ボタン）を持たせる。持たせないと、広い画面では下部ナビも無く、設定以外へ移る手段が無い（issue #636）。
    <AppFrame current="activity" activityRunning={false}>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div className="flex items-center gap-2 text-xl font-semibold">
          <AppMenuButton current="activity" />
          <Timer className="size-6 text-primary" />
          活動記録
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Google Calendarが接続されていません</CardTitle>
            <CardDescription>
              記録した内容はGoogle Calendarの予定として保存されます。先にカレンダーを接続してください。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/settings/google">設定へ</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <BottomNav current="activity" />
    </AppFrame>
  );
}
