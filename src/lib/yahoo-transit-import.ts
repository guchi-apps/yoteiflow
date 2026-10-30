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

/** メモ末尾の「電車の発着 … ／ 徒歩 前N分・後M分を含む」行を付ける（徒歩が無ければ付けない）。 */
function withWalkNote(noteText: string, departTime: string, arriveTime: string, before: number, after: number): string {
  const walkParts = [before > 0 ? `前${before}分` : null, after > 0 ? `後${after}分` : null].filter(Boolean);
  return walkParts.length > 0
    ? `${noteText}\n\n電車の発着 ${departTime}〜${arriveTime} ／ 徒歩 ${walkParts.join("・")}を含む`
    : noteText;
}

const WALK_NOTE_LINE = /\n\n電車の発着 [^\n]+ ／ 徒歩 ([^\n]+)を含む$/;

/**
 * 取り込み済みの経路（サーバーが共通の徒歩を足した結果）の徒歩を、別の値へ足し直す（issue #1471）。
 *
 * 足し済みの分（メモ末尾の行）を引いて電車の発着へ戻してから、新しい値を足す。ドアtoドア経路の徒歩側は
 * メモの経路テキストから判定し直し、その側は足さない（二重加算の回避）。
 * 経路を読めなければ null（呼び出し元は手を付けない）。
 */
export function retargetYahooWalk(
  travel: { departAt: string; arriveAt: string; note: string },
  walk: YahooTravelWalk,
): { departAt: string; arriveAt: string; note: string } | null {
  const route = parseYahooTransitRoute(travel.note);
  if (!route) return null;
  const line = WALK_NOTE_LINE.exec(travel.note);
  const addedBefore = Number(/前(\d+)分/.exec(line?.[1] ?? "")?.[1] ?? 0);
  const addedAfter = Number(/後(\d+)分/.exec(line?.[1] ?? "")?.[1] ?? 0);
  const before = route.walkAtStart ? 0 : Math.max(0, walk.before);
  const after = route.walkAtEnd ? 0 : Math.max(0, walk.after);
  const shifted = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
  return {
    departAt: shifted(travel.departAt, addedBefore - before),
    arriveAt: shifted(travel.arriveAt, after - addedAfter),
    note: withWalkNote(route.noteText.replace(WALK_NOTE_LINE, ""), route.departTime, route.arriveTime, before, after),
  };
}

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
  const note = withWalkNote(route.noteText, route.departTime, route.arriveTime, before, after);

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
