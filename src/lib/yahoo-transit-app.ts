/**
 * 移動の入力値から、Yahoo!乗換案内アプリの検索を開くリンクを組み立てる（issue #1330・docs/spec.md §29）。
 *
 * 形はYahoo!公式の `/app/redirectSearchDetail` がiPhoneで生成する `appUrlScheme` に揃える（実測）。
 * `ytransit://conditions?from=&to=&prop=y&d=YYYYMMDD&t=HHmm&type=1|4&ex=&se=&al=&hb=&lb=&sr=`
 *
 * - **交通機関の指定（ex 有料特急・se 新幹線・al 飛行機・hb 高速バス・lb 路線バス・sr フェリー）は
 *   省略すると公式の変換でも `0` になる。** Web検索の既定（すべて利用）と同じ結果を出すため、明示的に
 *   すべて `1` を渡す。
 * - 座標は `名前,経度,緯度` の順（Web用の `flatlon` は `緯度,経度`。公式の変換が入れ替えている）。
 * - 地点の決め方（最寄り駅 → 座標 → 住所）は Web と同じ `resolveYahooPlace()` に任せる。
 *
 * DaySpanが検索結果を取りにいくことは無い。経路はYahoo!アプリで利用者が選び、共有で戻す。
 */

import type { YahooTransitBasis, YahooTransitPlace } from "@/lib/yahoo-transit-link";

const APP_SEARCH = "ytransit://conditions";
const DEPART_AT = "1";
const ARRIVE_AT = "4";
const TRANSPORT_OPTIONS = ["ex", "se", "al", "hb", "lb", "sr"] as const;

export type TransitAppSearchInput = {
  origin: YahooTransitPlace;
  destination: YahooTransitPlace;
  /** 基準側の日時（入力欄の形式 `YYYY-MM-DDTHH:mm`・設定タイムゾーンの壁時計）。 */
  at: string;
  basis: YahooTransitBasis;
};

/** アプリで検索するリンク。日時の形が違えば null（黙って日時なしで開かない）。 */
export function yahooTransitAppLink(input: TransitAppSearchInput): string | null {
  const at = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input.at.trim());
  if (!at) return null;

  const params = new URLSearchParams();
  params.set("from", appPlace(input.origin));
  params.set("to", appPlace(input.destination));
  params.set("prop", "y");
  params.set("d", `${at[1]}${at[2]}${at[3]}`);
  params.set("t", `${at[4]}${at[5]}`);
  params.set("type", input.basis === "depart" ? DEPART_AT : ARRIVE_AT);
  for (const key of TRANSPORT_OPTIONS) params.set(key, "1");
  return `${APP_SEARCH}?${params.toString()}`;
}

function appPlace(place: YahooTransitPlace): string {
  if (place.coordinates) return `${place.name},${place.coordinates.lng},${place.coordinates.lat}`;
  return place.query;
}

export type TransitSearchForm = {
  origin: YahooTransitPlace | null;
  destination: YahooTransitPlace | null;
  departAt: string;
  arriveAt: string;
  basis: YahooTransitBasis;
};

export type TransitSearchCondition =
  | { ok: true; origin: YahooTransitPlace; destination: YahooTransitPlace; at: string; basis: YahooTransitBasis }
  | { ok: false; missing: string[] };

/**
 * 検索に要るものが揃っているか。必須は出発地・目的地・**基準側の日時だけ**（反対側の日時・所要時間は
 * Yahoo!が決めるため要らない）。欠けていれば何が足りないかを返し、条件を黙って捨てて開かない。
 */
export function transitSearchCondition(form: TransitSearchForm): TransitSearchCondition {
  const at = form.basis === "depart" ? form.departAt : form.arriveAt;
  const missing = [
    form.origin ? null : "出発地",
    form.destination ? null : "目的地",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at.trim()) ? null : form.basis === "depart" ? "出発日時" : "到着日時",
  ].filter((item): item is string => item !== null);
  if (missing.length > 0 || !form.origin || !form.destination) return { ok: false, missing };
  return { ok: true, origin: form.origin, destination: form.destination, at, basis: form.basis };
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 何で探すか（画面の確認用）。駅名・座標・住所・入力したままの文字列のどれで渡るかを示す。 */
export function transitPlaceLabel(place: YahooTransitPlace): string {
  if (place.coordinates) return `${place.name}（地点で検索）`;
  if (place.query !== place.name) return `${place.query}（住所で検索）`;
  return place.query;
}

/** 「梅田 → 本社（住所で検索）・11/1(日) 9:30 到着」 */
export function transitConditionSummary(condition: Extract<TransitSearchCondition, { ok: true }>): string {
  const [date, time] = condition.at.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const clock = `${Number(time.slice(0, 2))}:${time.slice(3, 5)}`;
  return `${transitPlaceLabel(condition.origin)} → ${transitPlaceLabel(condition.destination)}・${month}/${day}(${weekday}) ${clock} ${condition.basis === "depart" ? "出発" : "到着"}`;
}
