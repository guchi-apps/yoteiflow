/**
 * 予定を動かしたときに、紐づく移動をどれだけずらすか（issue #1301・docs/spec.md §29）。
 *
 * 移動は自動では動かさず、予定を保存した直後に確認画面で「はい（ずらす）・調べ直す・いいえ」を
 * 選ばせる。電車は新しい時刻に走っているとは限らず、DaySpanからダイヤを確かめる手段も無い
 * （Yahoo!は結果ページの機械取得を認めていない）ため。ここはその確認画面に出す候補を決めるだけで、
 * 書き込みは呼び出し側が行う。
 *
 * 前後は**動かす前の**予定の時刻で `travelRelation()` により決める。
 * - 予定前の移動は開始のずれ、予定後の移動は終了のずれだけずらす
 * - 予定と重なる移動は、予定をまるごと動かした（開始と終了のずれが同じ）ときだけずらす
 * - 終日の予定（前後も終日）は時刻の基準が無いため対象外
 */

import { travelRelation, type TravelRelation } from "@/lib/travel-relation";

export type FollowEventTimes = { start: string; end: string; allDay: boolean };

export type FollowTravel = {
  id: string;
  start: string;
  end: string;
  linkedEventId: string | null;
};

export type TravelShift<T extends FollowTravel = FollowTravel> = {
  travel: T;
  relation: TravelRelation;
  /** ずらす量（ミリ秒）。0 のものは候補に入れない。 */
  deltaMs: number;
  /** ずらした後の出発・到着（ISO 8601）。 */
  start: string;
  end: string;
};

export function planLinkedTravelShifts<T extends FollowTravel>(
  travels: readonly T[],
  eventId: string,
  previous: FollowEventTimes,
  next: FollowEventTimes,
): TravelShift<T>[] {
  if (previous.allDay || next.allDay) return [];

  const startDelta = Date.parse(next.start) - Date.parse(previous.start);
  const endDelta = Date.parse(next.end) - Date.parse(previous.end);
  if (Number.isNaN(startDelta) || Number.isNaN(endDelta)) return [];

  return travels.flatMap((travel) => {
    if (travel.linkedEventId !== eventId) return [];

    const relation = travelRelation(travel, previous);
    const deltaMs =
      relation === "before" ? startDelta : relation === "after" ? endDelta : startDelta === endDelta ? startDelta : 0;
    if (deltaMs === 0) return [];

    const start = Date.parse(travel.start);
    const end = Date.parse(travel.end);
    if (Number.isNaN(start) || Number.isNaN(end)) return [];

    return [
      {
        travel,
        relation,
        deltaMs,
        start: new Date(start + deltaMs).toISOString(),
        end: new Date(end + deltaMs).toISOString(),
      },
    ];
  });
}

/** 「30分あと」「1時間15分まえ」「1日あと」。確認画面の見出しに使う。 */
export function shiftAmountLabel(deltaMs: number): string {
  const totalMinutes = Math.round(Math.abs(deltaMs) / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [days ? `${days}日` : "", hours ? `${hours}時間` : "", minutes ? `${minutes}分` : ""].join("");
  return `${parts || "0分"}${deltaMs < 0 ? "まえ" : "あと"}`;
}

/**
 * Yahoo!乗換案内で探すときの基準。予定後の移動は「予定の終わりから出る」ので出発時刻、
 * それ以外は「予定の開始までに着く」ので到着時刻で探す。
 */
export function researchBasis(relation: TravelRelation): "depart" | "arrive" {
  return relation === "after" ? "depart" : "arrive";
}
