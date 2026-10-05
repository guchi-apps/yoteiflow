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

export type ShareHandoff =
  | { kind: "place"; title: string; address: string; lat: number | null; lng: number | null; url: string | null }
  | { kind: "travel"; origin: string; destination: string; mode: TravelMode; minutes: number | null };

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
    return {
      kind: "travel",
      origin,
      destination,
      mode,
      minutes: Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES ? minutes : null,
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
export const HANDOFF_QUERY_KEYS = ["newEvent", "newTravel", "title", "address", "lat", "lng", "url", "origin", "destination", "mode", "minutes"] as const;
