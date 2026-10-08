import { placeDisplayName } from "@/lib/place-text";
import { parseVia } from "@/lib/travel-via";

/**
 * 移動の見出し「出発地 → 経由地 → 目的地」（issue #1197）。経由地が無ければ「出発地 → 目的地」。
 * 予定の詳細・通知・持ち物・タスクの紐づけなど、移動を名前で呼ぶ箇所はここを通して揃える。
 * `via` は DB の値（JSON文字列）でも配列でもよい。
 */
export function travelTitle(plan: { origin: string; destination: string; via?: string | string[] | null }): string {
  const via = Array.isArray(plan.via) ? plan.via : parseVia(plan.via);
  return [plan.origin, ...via, plan.destination].map(placeDisplayName).join(" → ");
}
