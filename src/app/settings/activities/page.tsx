import { redirect } from "next/navigation";

import { ActivitySection } from "@/components/settings/activity-section";
import { SleepSection } from "@/components/settings/sleep-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { listActivityPresets } from "@/services/activity/presets";
import { getActivityCalendarId, getSleepSettings } from "@/services/activity/settings";
import { loadWritableCalendars } from "@/services/calendar/load";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

export default async function ActivitySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  // 記録の保存先はGoogle Calendar。接続していないと保存先が選べないため、
  // 先にGoogleの設定へ回ってもらう。
  const [presets, calendars, activityCalendarId, sleep] = await Promise.all([
    listActivityPresets(user.id),
    loadWritableCalendars(user.id),
    getActivityCalendarId(user.id),
    getSleepSettings(user.id),
  ]);

  if (calendars.length === 0) redirect("/settings/google");

  return (
    <SettingsShell
      title="活動記録"
      description="カレンダー画面の記録ボタンに並ぶ項目です。押した時点から記録が始まり、止めた時点までが予定として保存されます。"
      backHref="/settings"
      backLabel="設定"
    >
      <ActivitySection
        presets={presets}
        calendars={calendars}
        activityCalendarId={activityCalendarId}
      />

      {/* 睡眠は活動記録の1項目そのもので、どの項目を睡眠として数えるかは
          項目の一覧を見ながらでないと決められない（docs/spec.md §39）。 */}
      <SleepSection
        presets={presets}
        title={sleep.title}
        targetMinutes={sleep.targetMinutes}
      />
    </SettingsShell>
  );
}
