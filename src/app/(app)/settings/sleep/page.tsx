import { redirect } from "next/navigation";

import { SleepSection } from "@/components/settings/sleep-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";
import { listActivityPresets } from "@/services/activity/presets";
import { getSleepSettings } from "@/services/activity/settings";

export default async function SleepSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  // 睡眠は活動記録の1項目そのもの。どの項目を睡眠として数えるかを選ぶため項目の一覧を読む。
  // 名前と目標はDaySpanのDBだけで決まるため、保存先カレンダーが未接続でも設定できる。
  const [presets, sleep] = await Promise.all([
    listActivityPresets(user.id),
    getSleepSettings(user.id),
  ]);

  return (
    <SettingsShell
      title="睡眠"
      description="睡眠の画面で、どの活動記録の項目を睡眠として数えるかと、目標の睡眠時間を決めます。"
    >
      <SleepSection
        presets={presets}
        title={sleep.title}
        targetMinutes={sleep.targetMinutes}
      />
    </SettingsShell>
  );
}
