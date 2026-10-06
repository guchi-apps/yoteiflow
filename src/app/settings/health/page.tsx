import { redirect } from "next/navigation";

import { isoToLocalInput } from "@/components/calendar/datetime-fields";
import { HealthSection } from "@/components/settings/health-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { getSleepSettings } from "@/services/activity/settings";
import { getSleepHealthExportedUntil } from "@/services/activity/sleep-health-sent";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

/**
 * ヘルスケア連携の設定（docs/spec.md §40）。
 *
 * 連携はiOSアプリ（HealthKit）が行い、iPhoneショートカットは使わない。許可の状態はアプリに
 * 聞くため、サーバーで描くのは睡眠の項目名と「最後に送った時刻」だけ。
 */
export default async function HealthSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const [sleep, uiSetting, exportedUntil] = await Promise.all([
    getSleepSettings(user.id),
    db.uiSetting.findUnique({ where: { userId: user.id }, select: { timeZone: true } }),
    getSleepHealthExportedUntil(user.id),
  ]);
  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";

  return (
    <SettingsShell
      title="ヘルスケア"
      description="iPhoneのヘルスケアと睡眠を連携します。iOSアプリで利用できます。"
      backHref="/settings"
      backLabel="設定"
    >
      <HealthSection
        title={sleep.title}
        exportedLabel={
          exportedUntil ? isoToLocalInput(exportedUntil.toISOString(), timeZone).replace("T", " ") : null
        }
      />
    </SettingsShell>
  );
}
