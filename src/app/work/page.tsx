import Link from "next/link";
import { redirect } from "next/navigation";
import { Briefcase } from "lucide-react";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { WorkScreen } from "@/components/work/work-screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { workCapabilities, workDatabaseReady, workTripPlaces } from "@/services/notion/work-logs";
import { normalizeWorkMinutes } from "@/types/work";
import { getRunningActivity } from "@/services/activity/running";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const [connection, uiSetting, runningActivity] = await Promise.all([
    db.notionConnection.findUnique({ where: { userId: user.id } }),
    db.uiSetting.findUnique({
      where: { userId: user.id },
      select: { timeZone: true, workMinutesPerDay: true },
    }),
    // ナビの記録の項目へ印を出し、記録中バー（issue #629）に項目名・開始時刻を出すために読む
    // （docs/spec.md §27）。DaySpanのDBだけで完結するため、外部APIの往復は増えない。
    getRunningActivity(user.id),
  ]);

  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";
  const todayKey = createCalendarDateUtils(timeZone).todayKey();

  const { month } = await searchParams;
  const monthKey = month && MONTH_KEY.test(month) ? month : todayKey.slice(0, 7);

  // データソースと必須プロパティが揃っていないと、読むことも書くこともできない。
  if (!connection || !workDatabaseReady(connection)) return <ConnectPrompt />;

  // 月ごとの記録はここでは読まない。画面が GET /api/work/month から取る（issue #974）。
  // ここでNotionを待つと、月送りのたびにページの取り直しになり、オフライン・低速時に
  // 別の月が開けない。ページはDBだけで即座に返し、Notionの遅さで画面の枠が出ないことも避ける。
  return (
    <WorkScreen
      monthKey={monthKey}
      todayKey={todayKey}
      tripPlaces={workTripPlaces(connection)}
      capabilities={workCapabilities(connection)}
      runningActivity={runningActivity}
      timeZone={timeZone}
      workMinutesPerDay={normalizeWorkMinutes(uiSetting?.workMinutesPerDay)}
    />
  );
}

/** 勤務記録DBが未設定のとき。何を用意すればここが使えるようになるのかまで出す。 */
function ConnectPrompt() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-xl font-semibold">
        <Briefcase className="size-6 text-primary" />
        勤務
      </div>
      <Card>
        <CardHeader>
          <CardTitle>勤務記録DBが設定されていません</CardTitle>
          <CardDescription>
            勤務場所・出張・年休・休みはNotionのデータベースに記録します。設定のNotion画面で勤務記録DBを選ぶか、
            新しく作成してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings/notion">設定へ</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
