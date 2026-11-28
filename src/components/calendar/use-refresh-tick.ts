"use client";

import { useEffect, useState } from "react";

const TICK_MS = 60_000;

/**
 * 「古くなったら取り直す」判定をやり直すきっかけを数える（issue #1766）。
 *
 * 月表示（`useCalendarChunks`）・日/3日/週表示（`useCalendarRangeData`）は、取得時刻と
 * 自動更新の間隔（`UiSetting.autoRefreshSeconds`）を比べて取り直すが、その判定は表示期間や
 * 保持データが変わったときの effect の中でしか走らない。カレンダーを開いたままにしたり、
 * iOSアプリ・PWAを裏へ回して戻ったりしても、表示が動かなければ何時間でも取得時点の内容が
 * 残る（Notion側で完了したタスクが月表示に出続けた）。
 *
 * 1分ごと（画面が見えている間だけ。自動更新の間隔そのものにすると、取得時刻との比較が
 * わずかに届かず1周遅れることがあるため細かく刻む）と、画面が再び見えたとき（`visibilitychange`・
 * `pageshow`・`focus`）に値を進める。呼び出し側は effect の依存に入れて判定をやり直すだけで、
 * 取り直すかどうかは従来どおり取得時刻で決める（進めただけでは外部APIへの往復は増えない）。
 */
export function useRefreshTick(enabled: boolean): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const bump = () => {
      if (document.visibilityState === "visible") setTick((value) => value + 1);
    };
    const timer = setInterval(bump, TICK_MS);

    document.addEventListener("visibilitychange", bump);
    window.addEventListener("pageshow", bump);
    window.addEventListener("focus", bump);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", bump);
      window.removeEventListener("pageshow", bump);
      window.removeEventListener("focus", bump);
    };
  }, [enabled]);

  return tick;
}
