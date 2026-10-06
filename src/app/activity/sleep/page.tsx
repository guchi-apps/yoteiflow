import Link from "next/link";
import { redirect } from "next/navigation";
import { Moon } from "lucide-react";

import { SleepScreen } from "@/components/activity/sleep-screen";
import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { SLEEP_RANGE_DAYS, buildSleepNights } from "@/lib/sleep";
import { getRunningActivity } from "@/services/activity/running";
import { getSleepSettings } from "@/services/activity/settings";
import { loadSleepEvents, sleepNightKeys } from "@/services/activity/sleep";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

/** 既定で並べる夜の数。 */
const DEFAULT_DAYS = SLEEP_RANGE_DAYS[0];

/**
 * 睡眠の横通し表示（docs/spec.md §39）。
 *
 * 記録の画面（`/activity`）の下位画面。時間グリッドは日をまたぐ睡眠を0時で切り詰めて
 * 2本の帯に割るため、1回の睡眠が何時間だったのかがカレンダーからは読めない。
 */
export default async function SleepPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const [uiSetting, sleep, running] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId: user.id }, select: { timeZone: true } }),
    getSleepSettings(user.id),
    getRunningActivity(user.id),
  ]);

  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";
  const todayKey = createCalendarDateUtils(timeZone).todayKey();

  // 並べる日数はURLで決める。書かれていない・選択肢に無い値のときだけ既定へ落とす
  // （年休の年度と同じ扱い）。
  const { days: requested } = await searchParams;
  const days =
    SLEEP_RANGE_DAYS.find((value) => String(value) === requested) ?? DEFAULT_DAYS;

  const nightKeys = sleepNightKeys(todayKey, days);
  const loaded = await loadSleepEvents(user.id, { nightKeys, timeZone });

  // 保存先を指定していないと、そこに普通の予定も混ざるため、どれが記録なのか区別できない
  // （docs/spec.md §27）。何を設定すればこの画面が使えるのかまで出す。
  if (!loaded.ok && loaded.reason === "calendar_not_selected") return <CalendarPrompt />;

  const now = new Date();

  const nights = buildSleepNights({
    events: loaded.ok ? loaded.events : [],
    running,
    title: sleep.title,
    nightKeys,
    timeZone,
    now,
  });

  return (
    <SleepScreen
      nights={nights}
      targetMinutes={sleep.targetMinutes}
      todayKey={todayKey}
      days={days}
      activityTitle={sleep.title}
      timeZone={timeZone}
      loadError={
        loaded.ok
          ? null
          : `睡眠の記録を取得できませんでした。${loaded.message ?? ""}`.trim()
      }
    />
  );
}

/** 記録の保存先カレンダーが決まっていないとき。 */
function CalendarPrompt() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-xl font-semibold">
        <Moon className="size-6 text-primary" />
        睡眠
      </div>

      <Card>
        <CardHeader>
          <CardTitle>記録の保存先が決まっていません</CardTitle>
          <CardDescription>
            睡眠は活動記録として保存されます。保存先を指定していないと予定作成の既定の
            カレンダーへ入り、そこには普通の予定も混ざるため、どれが記録なのか区別できません。
            設定の活動記録で保存先のカレンダーを選んでください。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button asChild>
            <Link href="/settings/activities">設定へ</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/activity">記録へ戻る</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
