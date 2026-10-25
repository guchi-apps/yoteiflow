"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { AppSidebar } from "@/components/nav/app-sidebar";
import type { RunningActivitySummary } from "@/types/activity";

export type NavState = {
  activityRunning: boolean;
  timeZone: string;
  running: RunningActivitySummary | null;
};

const NavStateContext = createContext<NavState | null>(null);

/** `SettingsFrame` が取得した記録中・タイムゾーン。枠の外では null。 */
export function useNavState(): NavState | null {
  return useContext(NavStateContext);
}

/**
 * 戻るボタン付きの画面（睡眠・日付・場所・設定。issue #1384）の外枠。
 *
 * 768px以上では `AppFrame` と同じサイドバーを左端に置く。この画面群はページごとに記録中の
 * 有無を持たないため、開いたときに1回だけ `/api/nav-state` を取り、下部ナビ
 * （`SettingsBottomNav`）とコンテキストで共有する。取れなくても印が出ないだけで使える。
 * 現在地はどの5画面でもないので、サイドバーにハイライトは付けない。
 *
 * 本文の列は `@container/main` にする。段組みは画面幅ではなくこの列の幅で切り替える
 * （サイドバーのぶん本文が狭まるため）。
 */
export function SettingsFrame({ children }: { children: ReactNode }) {
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
    <NavStateContext.Provider value={state}>
      <div className="flex">
        {/* ページごとスクロールする画面もあるため、サイドバーは画面の高さに張り付かせる。 */}
        <div className="sticky top-[env(safe-area-inset-top,0px)] z-30 flex h-app shrink-0 self-start">
          <AppSidebar
            current={null}
            activityRunning={state?.activityRunning ?? false}
            running={state?.running ?? null}
          />
        </div>
        <div className="@container/main min-w-0 flex-1">{children}</div>
      </div>
    </NavStateContext.Provider>
  );
}
