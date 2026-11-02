// 記録の開始・終了に指定された時刻を画面側で確かめるための関数（docs/spec.md §27）。
//
// サーバー側でも同じ判定を行うが（services/activity/running.ts）、押してから往復ぶん
// 待たせて断ると、どの欄が悪いのかを確かめるまでが遠くなる。押す前に分かるものはここで断る。

import { formatElapsed } from "@/components/calendar/activity-format";
import { isoToLocalInput, localInputToIso } from "@/components/calendar/datetime-fields";
import type { RunningActivityItem } from "@/types/activity";

/**
 * 指定された開始時刻を受け付けられない理由。受け付けられるなら null。
 *
 * `YYYY-MM-DDTHH:mm` は辞書順と時刻順が一致するため、文字列のまま比べられる。
 * 分より細かい差は見ない（入力欄が分までしか持たず、サーバー側も分のずれは丸める）。
 */
export function invalidStartAt(
  value: string,
  nowInput: string | null,
  running: RunningActivityItem | null,
  timeZone: string,
): string | null {
  if (!value) return "開始日と開始時刻の両方を入れてください。";
  if (nowInput && value > nowInput) return "これから先の時刻からは記録を始められません。";

  if (running) {
    const startedAt = isoToLocalInput(running.startedAt, timeZone);
    if (value < startedAt) {
      // 切り替えでは、この時刻が記録中のものの終わりにもなる。前の記録の開始より前だと、
      // 何時から何時までの予定にすればよいのかが決まらない。
      return `記録中の「${running.title}」の開始（${startedAt.replace("T", " ")}）より後の時刻を指定してください。`;
    }
  }

  return null;
}

/**
 * 記録中の開始時刻を直すときの入力を受け付けられない理由（issue #1483）。受け付けられるなら null。
 *
 * 空と未来だけを断る。`invalidStartAt` は切り替え用で、いまの記録の開始より前を断るが、
 * 開始時刻の修正は押し忘れて後から前倒しするのが主な使い方のため、前倒しは受け付ける。
 */
export function invalidStartEdit(value: string, nowInput: string | null): string | null {
  if (!value) return "開始日と開始時刻の両方を入れてください。";
  if (nowInput && value > nowInput) return "これから先の時刻は指定できません。";
  return null;
}

/** 指定された終了時刻を受け付けられない理由。受け付けられるなら null。 */
export function invalidEnd(
  value: string,
  nowInput: string | null,
  running: RunningActivityItem,
  timeZone: string,
): string | null {
  if (!value) return "終了日と終了時刻の両方を入れてください。";
  if (nowInput && value > nowInput) return "これから先の時刻では止められません。";

  const startedAt = isoToLocalInput(running.startedAt, timeZone);
  if (value < startedAt) {
    return `開始（${startedAt.replace("T", " ")}）より後の時刻を指定してください。`;
  }

  return null;
}

/** 「この時刻で停止」を押したときに保存される時間帯と長さ。 */
export function savedRangeLabel(startIso: string, endInput: string, timeZone: string): string {
  const start = new Date(startIso).getTime();
  // 同じ分で止めると、サーバー側で最短の長さまで伸びる（MIN_ACTIVITY_MINUTES）。
  // 伸びたあとの長さを出さないと、保存された予定と画面の数字が食い違う。
  const end = Math.max(new Date(localInputToIso(endInput, timeZone)).getTime(), start + 60_000);

  const from = isoToLocalInput(startIso, timeZone).replace("T", " ");
  const to = new Date(end).toISOString();

  return `${from} 〜 ${isoToLocalInput(to, timeZone).replace("T", " ")}（${formatElapsed(startIso, to)}）の予定として保存します。`;
}
