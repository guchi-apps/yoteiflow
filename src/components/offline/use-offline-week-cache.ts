"use client";

import { useEffect } from "react";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { isNativeApp } from "@/lib/native-push";
import { buildOfflineWeekPlan } from "@/lib/offline-week";

/** 起動直後は画面自身の取得を先に通す。同時に走るとNotionの回数制限で画面の取得が失敗しうる。 */
const START_DELAY_MS = 5000;

/**
 * iOSアプリで、今日から1週間ぶんを Service Worker に先に保存させる（issue #1489・docs/spec.md §21）。
 *
 * 開いたとき・画面に戻ったとき・通信が戻ったときに頼む。取り直しの間引き（1時間）は
 * Service Worker 側（`warmWeek()`）が持つため、ここは素朴に送るだけでよい。
 */
export function useOfflineWeekCache(timeZone: string): void {
  useEffect(() => {
    if (!isNativeApp()) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const plan = buildOfflineWeekPlan(createCalendarDateUtils(timeZone).todayKey(), timeZone);
        navigator.serviceWorker?.ready
          .then((registration) => registration.active?.postMessage(plan))
          .catch(() => {
            // Service Worker が居なければ保存できない。オンラインの表示には関わらない。
          });
      }, START_DELAY_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") schedule();
    };

    schedule();
    window.addEventListener("online", schedule);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", schedule);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [timeZone]);
}
