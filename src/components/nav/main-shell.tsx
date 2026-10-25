"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { AppMenuButton } from "@/components/nav/app-drawer";
import { AppFrame } from "@/components/nav/app-frame";
import { BottomNav } from "@/components/nav/main-nav";
import { NAV_ITEMS, type NavKey } from "@/components/nav/nav-items";
import { RunningActivityBar } from "@/components/nav/running-activity-bar";
import type { RunningActivitySummary } from "@/types/activity";

/** カレンダー画面だけが差し込む、下部ナビの「カレンダー」の動き（main-nav.tsx）。 */
type CalendarNavHandlers = { onClick: () => void; onLongPress: () => void };

type MainShellContextValue = {
  /** ヘッダーの差し込み口。マウント前は null。 */
  headerSlot: HTMLElement | null;
  /** 記録中の1件。シェルが1つだけ持ち、ナビの印・記録中バー・サイドバー・各画面が同じ値を見る。 */
  running: RunningActivitySummary | null;
  setRunning: (running: RunningActivitySummary | null) => void;
  registerCalendarHandlers: (handlers: CalendarNavHandlers | null) => void;
};

const MainShellContext = createContext<MainShellContextValue | null>(null);

function useMainShell(): MainShellContextValue {
  const value = useContext(MainShellContext);
  if (!value) throw new Error("MainShell の外では使えません。");
  return value;
}

/** 記録中かどうか（ナビの印・FABの位置に使う）。 */
export function useShellRunning(): RunningActivitySummary | null {
  return useMainShell().running;
}

/** 記録の開始・停止を画面から常駐シェルへ伝える。 */
export function useSetShellRunning() {
  return useMainShell().setRunning;
}

/**
 * ヘッダーに画面ごとの操作を差し込む（issue #1395）。
 *
 * メニューボタン・ヘッダーの枠は常駐シェルが持ち、画面を移っても作り直さない。
 * 画面が描くのは、その右に並ぶ操作だけ。差し込み口は `display: contents` なので、
 * 差し込んだ要素はヘッダーの flex の直接の子として並ぶ。
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const { headerSlot } = useMainShell();
  if (!headerSlot) return null;
  return createPortal(children, headerSlot);
}

/** カレンダー画面が、下部ナビの「カレンダー」の押下・長押しを受け持つために登録する。 */
export function useRegisterCalendarNav(handlers: CalendarNavHandlers) {
  const { registerCalendarHandlers } = useMainShell();
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    registerCalendarHandlers({
      onClick: () => latest.current.onClick(),
      onLongPress: () => latest.current.onLongPress(),
    });
    return () => registerCalendarHandlers(null);
  }, [registerCalendarHandlers]);
}

function navKeyOf(pathname: string): NavKey {
  const item = NAV_ITEMS.find(
    (nav) => pathname === nav.href || pathname.startsWith(`${nav.href}/`),
  );
  return item?.key ?? "calendar";
}

/**
 * 下部ナビから開く5画面の常駐シェル（issue #1395）。
 *
 * サイドバー・ヘッダーの枠とメニューボタン・記録中バー・下部ナビを `(main)` のレイアウトに
 * 1度だけ置く。画面を移っても作り直されず、位置も変わらない。
 */
export function MainShell({
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

  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [calendarHandlers, setCalendarHandlers] = useState<CalendarNavHandlers | null>(null);

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
  // 画面ごとのページが毎回読んでいたのと同じ鮮度を保つ（他の端末で止めた記録を残さない）。
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

  const registerCalendarHandlers = useCallback(
    (handlers: CalendarNavHandlers | null) => setCalendarHandlers(handlers),
    [],
  );

  const value = useMemo<MainShellContextValue>(
    () => ({ headerSlot, running, setRunning, registerCalendarHandlers }),
    [headerSlot, running, registerCalendarHandlers],
  );

  const activityRunning = running !== null;
  // 記録の画面は記録中のカードを本文に持つため、サイドバーの下端・記録中バーには出さない。
  const shownRunning = current === "activity" ? null : running;

  return (
    <MainShellContext.Provider value={value}>
      <AppFrame current={current} activityRunning={activityRunning} running={shownRunning}>
        <header className="flex items-center gap-1 bg-surface-container-low px-1 py-1.5 md:gap-2 md:px-2 md:py-2 md:max-lg:flex-wrap md:max-lg:justify-end">
          {/* 768px未満は左上をメニューにする（issue #328・#463）。768px以上は左端のサイドバーから
              画面を移る（issue #636）。位置は画面を移っても変わらない（issue #1395）。 */}
          <AppMenuButton current={current} activityRunning={activityRunning} />
          <div ref={setHeaderSlot} className="contents" />
        </header>

        {children}

        <RunningActivityBar running={shownRunning} />
        <BottomNav
          current={current}
          activityRunning={activityRunning}
          timeZone={timeZone}
          onCalendarClick={current === "calendar" ? calendarHandlers?.onClick : undefined}
          onLongPressCalendar={current === "calendar" ? calendarHandlers?.onLongPress : undefined}
        />
      </AppFrame>
    </MainShellContext.Provider>
  );
}
