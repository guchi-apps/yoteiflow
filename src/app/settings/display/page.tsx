import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DisplaySection } from "@/components/settings/display-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { StartPathSection } from "@/components/settings/start-path-section";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { DEFAULT_HOME_PATH, isStartPath, START_PATH_COOKIE } from "@/lib/home-path";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

export default async function DisplaySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const [uiSetting, cookieStore] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId: user.id } }),
    cookies(),
  ]);

  const startPathCookie = cookieStore.get(START_PATH_COOKIE)?.value;
  const startPath = isStartPath(startPathCookie) ? (startPathCookie as string) : DEFAULT_HOME_PATH;

  // カレンダー側と既定値を揃える。UiSettingが未作成のユーザーは日曜始まり。
  return (
    <SettingsShell
      title="表示"
      description="カレンダーの見た目と、アプリを開いたときの画面に関する設定です。"
      backHref="/settings"
      backLabel="設定"
    >
      <StartPathSection startPath={startPath} />
      <DisplaySection weekStartsOn={uiSetting?.weekStartsOn ?? 0} />
    </SettingsShell>
  );
}
