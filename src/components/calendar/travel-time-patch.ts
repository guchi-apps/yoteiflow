import type { TravelItem } from "@/types/calendar";

import { readErrorMessage } from "./response-error";

/**
 * 移動の出発・到着だけを変えて保存する（issue #1301）。移動の帯のドラッグと、予定を動かした
 * あとの「紐づく移動もずらす」の両方が使う。
 *
 * `PATCH /api/travels/[id]` は全項目を受け取って置き換える形のため、時刻以外は手元の値を
 * そのまま送る。紐づくタスク・持ち物の期限、Googleへ書き出した予定、通知の下書きは
 * サーバー側の `updateTravel()` が追随させる。予定との紐づけ（`linkedEventId`）は
 * この入口では変わらない（issue #1105）。
 *
 * 失敗したときは画面に出す文言を、成功したときは null を返す。
 */
export async function patchTravelTimes(
  travel: TravelItem,
  departAt: string,
  arriveAt: string,
  /** 変更シート（issue #1466）が手段・メモ・出どころも変えるとき。省略した項目は手元の値のまま。 */
  overrides: Partial<Pick<TravelItem, "mode" | "note" | "estimateSource" | "estimated">> = {},
): Promise<string | null> {
  try {
    const response = await fetch(`/api/travels/${encodeURIComponent(travel.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin: travel.origin,
        destination: travel.destination,
        via: travel.via,
        mode: overrides.mode ?? travel.mode,
        departAt,
        arriveAt,
        note: "note" in overrides ? overrides.note : travel.note,
        estimated: overrides.estimated ?? travel.estimated,
        estimateSource: overrides.estimateSource ?? travel.estimateSource,
      }),
    });
    if (response.ok) return null;
    return await readErrorMessage(response, "移動を保存できませんでした。");
  } catch {
    return "移動を保存できませんでした。";
  }
}
