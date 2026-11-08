"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AppSidebar } from "@/components/nav/app-sidebar";
import { NAV_ITEMS, type NavKey } from "@/components/nav/nav-items";
import { StrandedScrollReset } from "@/components/nav/stranded-scroll-reset";
import type { RunningActivitySummary } from "@/types/activity";

export type NavState = {
  activityRunning: boolean;
  timeZone: string;
  running: RunningActivitySummary | null;
};

type AppShellContextValue = NavState & {
  setRunning: (running: RunningActivitySummary | null) => void;
  /** 下部ナビの5画面のどれかを開いているときのキー。睡眠・年休・日付・場所・設定では null。 */
  current: NavKey | null;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function useAppShell(): AppShellContextValue {
  const value = useContext(AppShellContext);
  if (!value) throw new Error("AppShell の外では使えません。");
  return value;
}

/** 記録中・タイムゾーン（戻るボタン付きだった画面の下部ナビ・メニューボタンが使う）。 */
export function useNavState(): NavState {
  return useAppShell();
}

/**
 * 現在地を決める。5画面の本文ルート（配下を含む）だけが対象。
 * `/activity/sleep`・`/work/leave` は前方一致で「記録」「勤務」になってしまうため、明示的に除く。
 */
const NON_NAV_PATHS = ["/activity/sleep", "/work/leave"];

export function navKeyOf(pathname: string): NavKey | null {
  if (NON_NAV_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return null;
  }
  const item = NAV_ITEMS.find(
    (nav) => pathname === nav.href || pathname.startsWith(`${nav.href}/`),
  );
  return item?.key ?? null;
}

/**
 * ログイン後の全画面の常駐シェル（issue #1499）。
 *
 * 768px以上の左サイドバーと、記録中の1件・タイムゾーンをここで1度だけ持つ。
 * 睡眠・日付・場所・設定・年休へ移っても、サイドバーは作り直されない。
 * 5画面（`(main)`）の本文枠は `MainShell`、それ以外はページごとの骨格が内側を描く。
 *
 * 本文の列は `@container/main` にする。段組みは画面幅ではなくこの列の幅で切り替える
 * （サイドバーのぶん本文が狭まるため）。
 */
export function AppShell({
  initialRunning,
  timeZone,
  children,
}: {
  initialRunning: RunningActivitySummary | null;
  timeZone: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = navKeyOf(pathname);

  // 表示の正はサーバーから受けた記録中の値。取り直し（router.refresh）で別の値が届いたら
  // その場の状態より優先する（use-running-activity-stop.ts と同じ派生stateのパターン）。
  const serverKey = initialRunning ? `${initialRunning.title} ${initialRunning.startedAt}` : "";
  const [knownKey, setKnownKey] = useState(serverKey);
  const [running, setRunning] = useState(initialRunning);
  if (knownKey !== serverKey) {
    setKnownKey(serverKey);
    setRunning(initialRunning);
  }

  // レイアウトは画面を移っても再実行されないため、移動のたびに記録中の値だけ読み直す。
  // 他の端末で止めた記録を残さない（軽量・DBのみ）。
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (firstPath.current === pathname) return;
    firstPath.current = pathname;
    let cancelled = false;
    fetch("/api/nav-state")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { running?: RunningActivitySummary | null } | null) => {
        if (!cancelled && data && "running" in data) setRunning(data.running ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const value = useMemo<AppShellContextValue>(
    () => ({ activityRunning: running !== null, timeZone, running, setRunning, current }),
    [running, timeZone, current],
  );

  // 記録の画面は記録中のカードを本文に持つため、サイドバーの下端には出さない。
  const shownRunning = current === "activity" ? null : running;

  return (
    <AppShellContext.Provider value={value}>
      <div className="flex">
        {/* ページごとスクロールする画面もあるため、サイドバーは画面の高さに張り付かせる。 */}
        <div className="sticky top-[env(safe-area-inset-top,0px)] z-30 flex h-app shrink-0 self-start">
          <AppSidebar
            current={current}
            activityRunning={running !== null}
            running={shownRunning}
          />
        </div>
        <div className="@container/main min-w-0 flex-1">{children}</div>
      </div>
      {/* 5画面は h-app の固定高で文書そのものはスクロールしない。iOSのキーボードが
          ずらしたまま残した位置を戻す（issue #899）。ページごとスクロールする画面は対象外。 */}
      {current !== null && <StrandedScrollReset />}
    </AppShellContext.Provider>
  );
}
