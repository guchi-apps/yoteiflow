"use client";

import { useEffect, useState } from "react";

import { BottomNav } from "@/components/nav/main-nav";

type NavState = { activityRunning: boolean; timeZone: string };

/**
 * 戻るボタン付きの画面（`SettingsShell`）の下端に固定する下部ナビ（issue #1348）。
 *
 * 25ページ共通の骨格はページごとに記録中・タイムゾーンを持たないため、開いたときに
 * 1回だけ取りにいく。取れなくても印が出ないだけで、ナビ自体は使える。
 * 768px以上では `BottomNav` 自身が隠れる。
 */
export function SettingsBottomNav() {
  const [state, setState] = useState<NavState | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/nav-state")
      .then((response) => (response.ok ? (response.json() as Promise<NavState>) : null))
      .then((next) => {
        if (!cancelled && next) setState(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="sticky bottom-0 z-20 md:hidden">
      <BottomNav current={null} activityRunning={state?.activityRunning ?? false} timeZone={state?.timeZone} />
    </div>
  );
}
