/**
 * iOS共有拡張 → 本体アプリへ渡す入力の引き継ぎ（issue #1083）。
 *
 * 拡張は `yoteiflow://open?path=/calendar&newEvent=1&…` で本体を開き、カレンダー画面が
 * クエリを読んで予定・移動の入力を開く。クエリは利用者が書き換えられる入力なので、
 * 形・長さ・数値をここで検証し、通らなければ無視する。Swift側の組み立て
 * （`SharedConfig.handoffURL`）と許可キーを揃えること（`check-consistency.mjs`が照合する）。
 */

import { isTravelMode, type TravelMode } from "@/types/calendar";

const MAX_TEXT = 500;
const MAX_MINUTES = 24 * 60;
/** 経路詳細のメモ。他の値（500字）と違い、共有された経路の全文を渡すため大きく取る。超えたら黙って切らず、メモなしで開く側へ倒すのではなく導線ごと無効にする。 */
export const MAX_HANDOFF_NOTE = 20_000;

export type ShareHandoff =
  | { kind: "place"; title: string; address: string; lat: number | null; lng: number | null; url: string | null }
  | {
      kind: "travel";
      origin: string;
      destination: string;
      mode: TravelMode;
      minutes: number | null;
      /** 既存の予定に紐づけて作る（issue #1128）。共有で読めた発着時刻（ISO）を伴う。 */
      link: { departAt: string; arriveAt: string; note: string } | null;
    };

function text(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= MAX_TEXT ? trimmed : null;
}

function coordinate(value: string | null, limit: number): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

function googleMapsUrl(value: string | null): string | null {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isoTime(value: string | null): string | null {
  if (!value || value.length > 64) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** 紐づけ用の発着時刻。読めない・到着が出発以前なら紐づけ導線にせず、従来の入力へ落とす。 */
function linkTimes(
  depart: string | null,
  arrive: string | null,
  note: string | null,
): { departAt: string; arriveAt: string; note: string } | null {
  // メモは切り捨てない。上限を超える値は、欠けたメモで成功したように見せず導線ごと断る（拡張側も同じ上限で先に断る）
  if (note !== null && note.length > MAX_HANDOFF_NOTE) return null;
  const departAt = isoTime(depart);
  const arriveAt = isoTime(arrive);
  if (!departAt || !arriveAt || new Date(arriveAt).getTime() <= new Date(departAt).getTime()) return null;
  return { departAt, arriveAt, note: note ?? "" };
}

/**
 * 紐づけ先の予定を選んだあとの発着時刻（入力欄の形式 YYYY-MM-DDTHH:mm）。
 * 共有から取るのは到着の時刻と所要時間だけで、日付は予定から決める（issue #1128・日付は入力欄のまま動かさない決定と同じ）。
 * 到着日＝予定の開始日、出発＝到着から所要時間ぶん遡る。入力はいずれも設定タイムゾーンの入力形式。
 */
export function linkedTravelTimes(
  eventStartLocal: string,
  sharedDepartLocal: string,
  sharedArriveLocal: string,
): { departAt: string; arriveAt: string } {
  const arriveAt = `${eventStartLocal.slice(0, 10)}${sharedArriveLocal.slice(10)}`;
  const durationMs = new Date(`${sharedArriveLocal}:00Z`).getTime() - new Date(`${sharedDepartLocal}:00Z`).getTime();
  const departAt = new Date(new Date(`${arriveAt}:00Z`).getTime() - durationMs).toISOString().slice(0, 16);
  return { departAt, arriveAt };
}

export function parseShareHandoff(search: string): ShareHandoff | null {
  const params = new URLSearchParams(search);

  if (params.get("newEvent") === "place") {
    const title = text(params.get("title")) ?? "";
    const address = text(params.get("address")) ?? "";
    const lat = coordinate(params.get("lat"), 90);
    const lng = coordinate(params.get("lng"), 180);
    const hasPoint = lat !== null && lng !== null;
    if (!title && !address && !hasPoint) return null;
    return { kind: "place", title, address, lat: hasPoint ? lat : null, lng: hasPoint ? lng : null, url: googleMapsUrl(params.get("url")) };
  }

  if (params.get("newTravel") === "1") {
    const origin = text(params.get("origin"));
    const destination = text(params.get("destination"));
    const mode = params.get("mode");
    if (!origin || !destination || !isTravelMode(mode)) return null;
    const minutes = Number(params.get("minutes"));
    const link = params.get("link") === "1" ? linkTimes(params.get("departAt"), params.get("arriveAt"), params.get("note")) : null;
    return {
      kind: "travel",
      origin,
      destination,
      mode,
      minutes: Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES ? minutes : null,
      link,
    };
  }
  return null;
}

/** 予定の場所欄へ入れる文字列。DaySpanの場所欄は `名前 住所` の形（`place-text.ts`）に揃える。 */
export function handoffLocationText(handoff: Extract<ShareHandoff, { kind: "place" }>): string {
  const label = [handoff.title, handoff.address].filter(Boolean).join(" ");
  if (label) return label;
  return handoff.lat !== null && handoff.lng !== null ? `${handoff.lat},${handoff.lng}` : "";
}

/** ハンドオフの検証が必要なクエリのキー。ページ側で消すときに使う。 */
export const HANDOFF_QUERY_KEYS = ["newEvent", "newTravel", "title", "address", "lat", "lng", "url", "origin", "destination", "mode", "minutes", "link", "departAt", "arriveAt", "note"] as const;
