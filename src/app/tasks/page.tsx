import Link from "next/link";
import { redirect } from "next/navigation";
import { ListChecks } from "lucide-react";

import { TaskList } from "@/components/tasks/task-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { getRunningActivity } from "@/services/activity/running";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

export default async function TasksPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const [uiSetting, connection, runningActivity] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId: user.id } }),
    db.notionConnection.findUnique({ where: { userId: user.id } }),
    // ナビの記録の項目へ印を出し、記録中バー（issue #629）に項目名・開始時刻を出すために読む
    // （docs/spec.md §27）。止め忘れたまま別の画面で作業していると、その間ずっと同じ項目を
    // 記録し続けてしまう。DaySpanのDBだけで完結するため、外部APIの往復は増えない。
    getRunningActivity(user.id),
  ]);

  if (!connection?.taskDataSourceId) return <ConnectPrompt />;

  // 一覧・タグ・場所・カレンダーはここで待たない。Notionが遅いと追加ボタンまで出なくなるため、
  // 画面の枠だけをすぐ返し、中身はクライアントが /api/tasks/all から背景取得する（issue #724）。
  return (
    <TaskList
      weekStartsOn={uiSetting?.weekStartsOn ?? 0}
      timeZone={uiSetting?.timeZone ?? "Asia/Tokyo"}
      runningActivity={runningActivity}
    />
  );
}

function ConnectPrompt() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-xl font-semibold">
        <ListChecks className="size-6 text-primary" />
        タスク
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Notionが接続されていません</CardTitle>
          <CardDescription>
            設定画面でNotionを接続し、タスクDBを選択するとここに表示されます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings">設定へ</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
