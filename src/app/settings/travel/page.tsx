import { redirect } from "next/navigation";

import { SettingsShell } from "@/components/settings/settings-shell";
import { TravelSection } from "@/components/settings/travel-section";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadWritableCalendars } from "@/services/calendar/load";
import { loadPlaceCatalog } from "@/services/notion/places";
import { getTravelSettings } from "@/services/travel/settings";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

export default async function TravelSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  // 移動そのものはDaySpanのDBにあるため、Google未接続でも設定は開ける
  // （書き出し先が選べないだけで、出発地・交通手段・往復は使える）。
  // 場所DBは既定の出発地の候補に使う。取得に失敗しても loadPlaceCatalog は空を返すため、
  // Notion未接続・場所DB未設定でも設定画面は開ける（候補が出ないだけ）。
  const [settings, calendars, placeCatalog] = await Promise.all([
    getTravelSettings(user.id),
    loadWritableCalendars(user.id),
    db.notionConnection
      .findUnique({ where: { userId: user.id } })
      .then((connection) => loadPlaceCatalog(connection)),
  ]);

  return (
    <SettingsShell
      title="移動"
      description="出発地から目的地までの移動です。予定の詳細から「移動を足す」で作れます。Googleカレンダーへも書き出すと、他の端末のカレンダーからも見られます。"
      backHref="/settings"
      backLabel="設定"
    >
      <TravelSection settings={settings} calendars={calendars} placeCatalog={placeCatalog} />
    </SettingsShell>
  );
}
