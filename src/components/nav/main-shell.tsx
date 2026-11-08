"use client";

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
import { useAppShell } from "@/components/nav/app-shell";
import type { NavKey } from "@/components/nav/nav-items";
import { BottomNav } from "@/components/nav/main-nav";
import { RunningActivityBar } from "@/components/nav/running-activity-bar";
import { useOfflineWeekCache } from "@/components/offline/use-offline-week-cache";
import type { RunningActivitySummary } from "@/types/activity";

/** カレンダー画面だけが差し込む、下部ナビの「カレンダー」の動き（main-nav.tsx）。 */
type CalendarNavHandlers = { onClick: () => void; onLongPress: () => void };

type MainShellContextValue = {
  /** ヘッダーの差し込み口。マウント前は null。 */
  headerSlot: HTMLElement | null;
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
  return useAppShell().running;
}

/** 記録の開始・停止を画面から常駐シェルへ伝える。 */
export function useSetShellRunning() {
  return useAppShell().setRunning;
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

/**
 * 下部ナビから開く5画面の常駐シェル（issue #1395）。
 *
 * サイドバー・ヘッダーの枠とメニューボタン・記録中バー・下部ナビを `(main)` のレイアウトに
 * 1度だけ置く。画面を移っても作り直されず、位置も変わらない。
 */
export function MainShell({ children }: { children: ReactNode }) {
  const { current: shellCurrent, activityRunning, running, timeZone } = useAppShell();
  // `(main)` の配下は必ず5画面のどれか。
  const current: NavKey = shellCurrent ?? "calendar";

  useOfflineWeekCache(timeZone);

  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [calendarHandlers, setCalendarHandlers] = useState<CalendarNavHandlers | null>(null);

  const registerCalendarHandlers = useCallback(
    (handlers: CalendarNavHandlers | null) => setCalendarHandlers(handlers),
    [],
  );

  const value = useMemo<MainShellContextValue>(
    () => ({ headerSlot, registerCalendarHandlers }),
    [headerSlot, registerCalendarHandlers],
  );

  // 記録の画面は記録中のカードを本文に持つため、記録中バーには出さない。
  const shownRunning = current === "activity" ? null : running;

  return (
    <MainShellContext.Provider value={value}>
      <div className="flex h-app flex-col">
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
      </div>
    </MainShellContext.Provider>
  );
}
