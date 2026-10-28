/**
 * Yahoo!乗換案内の共有で受け取った経路のテキストから、予定に紐づかない新規の移動を作る入力を求める
 * （issue #1026・docs/spec.md §29）。iOSの共有拡張 → `/api/shortcuts/travel/import` が使う。
 *
 * 読み方は移動の入力欄への貼り付け（`applyYahooRoute`）と同じ規則: 日付は検索日を採用し、
 * 乗車駅・降車駅を出発地・目的地にし、メモは案内文を除いた生テキストをそのまま使う。
 * 画面と違い確かめる相手がいないため、検索日・発着時刻が読めなければ作らずに断る。
 */

import { localInputToIso } from "@/components/calendar/datetime-fields";
import {
  parseYahooTransitRoute,
  yahooRouteFields,
  yahooSearchedDateKey,
  yahooStationName,
} from "@/lib/yahoo-transit-route";

export type YahooTravelImport = {
  origin: string;
  destination: string;
  mode: "PUBLIC_TRANSIT";
  /** ISO 8601（設定タイムゾーンの壁時計をUTCへ直した値） */
  departAt: string;
  arriveAt: string;
  note: string;
  estimateSource: "YAHOO";
};

export type YahooTravelImportResult =
  | { ok: true; travel: YahooTravelImport }
  | { ok: false; error: "unreadable" | "no_date" | "no_stations"; message: string };

/** 電車の前後に足す徒歩の分（設定 ▸ 移動・issue #1463）。 */
export type YahooTravelWalk = { before: number; after: number };

export function buildYahooTravelImport(
  text: string,
  timeZone: string,
  walk: YahooTravelWalk = { before: 0, after: 0 },
): YahooTravelImportResult {
  const route = parseYahooTransitRoute(text);
  if (!route) {
    return {
      ok: false,
      error: "unreadable",
      message: "経路を読み取れませんでした。Yahoo!乗換案内の共有からコピーした文面を渡してください。",
    };
  }

  // 検索日が読めないまま今日などへ置くと、来週の移動が今日へ飛ぶ。作らずに断る。
  const baseDate = yahooSearchedDateKey(route);
  if (!baseDate) {
    return {
      ok: false,
      error: "no_date",
      message: "経路の検索日を読み取れなかったため、登録しませんでした。",
    };
  }

  const fields = yahooRouteFields(route, baseDate);
  if (!fields || !route.fromStation || !route.toStation) {
    return {
      ok: false,
      error: "no_stations",
      message: "出発駅・到着駅を読み取れなかったため、登録しませんでした。",
    };
  }

  // 座標・住所検索のドアtoドア経路は、その側の徒歩を既に含む。足さずに電車の時刻のまま使う。
  const before = route.walkAtStart ? 0 : Math.max(0, walk.before);
  const after = route.walkAtEnd ? 0 : Math.max(0, walk.after);
  const trainDepartIso = localInputToIso(fields.departAt, timeZone);
  const trainArriveIso = localInputToIso(fields.arriveAt, timeZone);
  const shifted = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

  // 時刻を広げたあとも電車の発着が分かるよう、メモの末尾に残す。
  const walkParts = [before > 0 ? `前${before}分` : null, after > 0 ? `後${after}分` : null].filter(Boolean);
  const note =
    walkParts.length > 0
      ? `${route.noteText}\n\n電車の発着 ${route.departTime}〜${route.arriveTime} ／ 徒歩 ${walkParts.join("・")}を含む`
      : route.noteText;

  return {
    ok: true,
    travel: {
      origin: yahooStationName(route.fromStation),
      destination: yahooStationName(route.toStation),
      mode: "PUBLIC_TRANSIT",
      departAt: shifted(trainDepartIso, -before),
      arriveAt: shifted(trainArriveIso, after),
      note,
      estimateSource: "YAHOO",
    },
  };
}
