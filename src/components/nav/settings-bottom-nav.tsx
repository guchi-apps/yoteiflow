"use client";

import { BottomNav } from "@/components/nav/main-nav";
import { useNavState } from "@/components/nav/settings-frame";

/**
 * 戻るボタン付きの画面（`SettingsShell` など）の下端に固定する下部ナビ（issue #1348）。
 *
 * 記録中・タイムゾーンは外枠（`SettingsFrame`）が1回だけ取った値を使う。
 * 取れなくても印が出ないだけで、ナビ自体は使える。768px以上では `BottomNav` 自身が隠れる。
 */
export function SettingsBottomNav() {
  const state = useNavState();

  return (
    <div className="sticky bottom-0 z-20 md:hidden">
      <BottomNav current={null} activityRunning={state?.activityRunning ?? false} timeZone={state?.timeZone} />
    </div>
  );
}
