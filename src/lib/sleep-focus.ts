import { sleepNightKey } from "@/lib/sleep";

/**
 * 睡眠モード（iOSのフォーカス「睡眠」）の切り替えで、睡眠の記録をどう動かすかの判定（issue #1109）。
 *
 * DB・外部APIには触れない純粋な計算にしてある（`lib/sleep.ts` と同じ立ち位置）。
 */

export type SleepFocusMode = "start" | "stop";

export type SleepFocusAction =
  /** 睡眠の記録を始める（他の項目を記録中なら、その終わりと同じ時刻で切り替える） */
  | "start"
  /** 同じ夜の睡眠をすでに記録中。何もしない（フォーカスの通知が重複しても二重にならない） */
  | "not_changed"
  /** 記録中の睡眠を止める */
  | "stop"
  /** 睡眠を記録していない。別の項目を記録中でも止めない */
  | "not_sleeping";

export function isSleepFocusMode(value: unknown): value is SleepFocusMode {
  return value === "start" || value === "stop";
}

/**
 * 記録中の項目と時刻から、実行する動作を決める。
 *
 * start は、記録中の項目が睡眠でも、開始が今夜の行（`sleepNightKey()`）と違えば始め直す。
 * 解除の通知を取りこぼした・通信に失敗した夜の記録が走ったまま残ると、次の晩の start が
 * 「記録中」で何もせず、記録が30時間を超える1件になって睡眠の平均が崩れるため。
 *
 * stop は睡眠を記録しているときだけ。睡眠モードを解除しただけで、別の項目の記録まで止めない。
 */
export function decideSleepFocusAction(
  mode: SleepFocusMode,
  running: { title: string; startedAt: string } | null,
  sleepTitle: string,
  now: Date,
  timeZone: string,
): SleepFocusAction {
  const sleeping = running !== null && running.title === sleepTitle;

  if (mode === "stop") return sleeping ? "stop" : "not_sleeping";

  if (!sleeping) return "start";

  const sameNight =
    sleepNightKey(running.startedAt, timeZone) === sleepNightKey(now.toISOString(), timeZone);
  return sameNight ? "not_changed" : "start";
}
