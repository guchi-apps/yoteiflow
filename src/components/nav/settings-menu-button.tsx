"use client";

import { AppMenuButton } from "@/components/nav/app-drawer";
import { useNavState } from "@/components/nav/settings-frame";

/**
 * 戻るボタン付きだった画面（睡眠・日付・場所・設定。issue #1404）の左上のメニューボタン。
 * 記録中の印は `SettingsFrame` が取得した値を使う（取れるまでは印なし）。
 */
export function SettingsMenuButton() {
  const state = useNavState();
  return <AppMenuButton activityRunning={state?.activityRunning ?? false} />;
}
