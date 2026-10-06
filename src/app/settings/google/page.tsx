import { redirect } from "next/navigation";

import { GoogleCalendarSection } from "@/components/settings/google-calendar-section";
import { HolidayCalendarSection } from "@/components/settings/holiday-calendar-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { getHolidayCalendarId } from "@/services/calendar/holiday-settings";
import { loadCalendarSettings } from "@/services/google-calendar/settings";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

export default async function GoogleSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const [{ google }, result, holidayCalendarId] = await Promise.all([
    searchParams,
    loadCalendarSettings(user.id),
    getHolidayCalendarId(user.id),
  ]);

  return (
    <SettingsShell
      title="Google Calendar"
      description="カレンダーごとに、表示するか・書き込みに使うかと並び順を選びます。ログインとは別に、カレンダーの読み書き権限を接続します。"
      backHref="/settings"
      backLabel="設定"
    >
      <GoogleCalendarSection result={result} connectResult={google} />
      <HolidayCalendarSection result={result} holidayCalendarId={holidayCalendarId} />
    </SettingsShell>
  );
}
