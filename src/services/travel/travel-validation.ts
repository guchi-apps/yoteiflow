import {
  isTravelMode,
  isTravelSearchPurpose,
  MAX_TRAVEL_SEARCH_MARGIN_MINUTES,
} from "@/types/calendar";
import type { TravelWriteInput } from "@/services/travel/plans";

/**
 * 入力の検証。作成・更新のどちらの経路でも同じ条件で断る。
 *
 * UIでも同じ検証をしているが、DaySpanのAPIや将来のMCPから直接呼ばれた要求は画面を通らない。
 * 時刻の前後関係は toWriteData 側で見る（Dateに直してからでないと判定できないため）。
 */
export function validateTravelInput(body: Partial<TravelWriteInput>): string | null {
  if (!body.origin?.trim()) return "出発地を入力してください。";
  if (!body.destination?.trim()) return "目的地を入力してください。";
  if (!isTravelMode(body.mode)) return "交通手段を選んでください。";
  if (!body.departAt || !body.arriveAt) return "出発時刻と到着時刻を入力してください。";
  if (body.searchPurpose != null && !isTravelSearchPurpose(body.searchPurpose)) return "探した意図の値が正しくありません。";
  if (
    body.searchMarginMinutes != null &&
    (!Number.isInteger(body.searchMarginMinutes) ||
      body.searchMarginMinutes < 0 ||
      body.searchMarginMinutes > MAX_TRAVEL_SEARCH_MARGIN_MINUTES)
  ) {
    return `余裕分は0〜${MAX_TRAVEL_SEARCH_MARGIN_MINUTES}分で入力してください。`;
  }
  if (body.searchEvent != null) {
    const { start, end, location } = body.searchEvent;
    if (
      typeof start !== "string" ||
      typeof end !== "string" ||
      Number.isNaN(Date.parse(start)) ||
      Number.isNaN(Date.parse(end)) ||
      (location != null && typeof location !== "string")
    ) {
      return "探したときの予定の値が正しくありません。";
    }
  }
  return null;
}
