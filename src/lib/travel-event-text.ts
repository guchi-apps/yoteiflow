import { parseVia } from "@/lib/travel-via";
import { TRAVEL_MODE_LABELS, type TravelEstimateSource, type TravelMode } from "@/types/calendar";

/** Googleへ書き出す移動の予定の文面（`services/travel/google-sync.ts` が使う純粋関数。DBを読まない） */

/** Googleの予定のタイトル。行き先と手段・所要時間まで入れて、Googleの画面だけでも読めるようにする。 */
export function travelEventTitle(plan: {
  destination: string;
  via?: string | null;
  mode: TravelMode;
  departAt: Date;
  arriveAt: Date;
}): string {
  return `→ ${[...parseVia(plan.via), plan.destination].join(" → ")}（${TRAVEL_MODE_LABELS[plan.mode]} ${travelMinutes(plan)}分）`;
}

/** 説明欄。出発地と交通手段はGoogleの予定の欄には無いため、ここへ残す。 */
export function travelEventDescription(plan: {
  origin: string;
  destination: string;
  via?: string | null;
  mode: TravelMode;
  departAt: Date;
  arriveAt: Date;
  note: string | null;
  estimateSource: TravelEstimateSource;
}): string {
  const via = parseVia(plan.via);
  const lines = [
    `出発地: ${plan.origin}`,
    ...(via.length > 0 ? [`経由地: ${via.join("、")}`] : []),
    `目的地: ${plan.destination}`,
    `交通手段: ${TRAVEL_MODE_LABELS[plan.mode]}`,
    `所要時間: ${travelMinutes(plan)}分${estimateSuffix(plan.estimateSource)}`,
  ];
  if (plan.note) lines.push("", plan.note);
  // YoteiFlowが書いた予定であることを残す。Google側で直接編集しても戻ることを伝えるため。
  lines.push("", "YoteiFlowの移動として管理しています。編集はYoteiFlowから行ってください。");
  return lines.join("\n");
}

/**
 * 所要時間に添える断り。Googleの予定の説明にも残す。
 *
 * DaySpanの画面を見ていない人（他の端末の標準カレンダー）が読む場所なので、
 * 手で入れた値と、AI・経路検索から入れた値を区別できるようにしておく。
 */
function estimateSuffix(source: TravelEstimateSource): string {
  if (source === "AI") return "（AIによる目安）";
  if (source === "TRANSIT") return "（経路検索の平均）";
  // Yahoo!乗換案内は実際のダイヤ上の列車なので、「目安」「平均」とは書かない。
  if (source === "YAHOO") return "（Yahoo!乗換案内）";
  if (source === "GOOGLE_MAPS") return "（Googleマップ）";
  return "";
}

function travelMinutes(plan: { departAt: Date; arriveAt: Date }): number {
  return Math.max(1, Math.round((plan.arriveAt.getTime() - plan.departAt.getTime()) / 60_000));
}
