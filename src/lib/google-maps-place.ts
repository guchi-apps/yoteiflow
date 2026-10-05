/**
 * Googleマップで共有された場所URLから、場所名・住所・座標を読む（issue #1083）。
 *
 * 経路は `google-maps-route.ts`、こちらは単一の場所。読めない部分は推測せず null にする。
 * 短縮URL（maps.app.goo.gl）の展開は `google-maps-expand.ts` が担当する。
 */

import type { LatLng } from "@/lib/coordinates";
import { isGoogleMapsHost } from "@/lib/google-maps-route";

export type GoogleMapsPlace = {
  /** 場所名（`/maps/place/<名前>/` や `?q=` の文字列）。座標だけのときは null */
  name: string | null;
  /** 名前に住所が続く形（`名前, 住所`）のときの住所部分 */
  address: string | null;
  coordinates: LatLng | null;
};

const MAX_LENGTH = 500;

function decode(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const text = decodeURIComponent(value.replace(/\+/g, " ")).trim();
    return text && text.length <= MAX_LENGTH ? text : null;
  } catch {
    return null;
  }
}

function toPoint(lat: string | undefined, lng: string | undefined): LatLng | null {
  if (lat === undefined || lng === undefined) return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
    ? point
    : null;
}

/** `!3d<lat>!4d<lng>` はピン本体の座標。`@lat,lng` は表示中の地図の中心なので後回しにする。 */
function coordinatesFrom(url: URL, text: string): LatLng | null {
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(text);
  if (pin) return toPoint(pin[1], pin[2]);

  const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? url.searchParams.get("ll");
  const fromQuery = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(query ?? "");
  if (fromQuery) return toPoint(fromQuery[1], fromQuery[2]);

  const center = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(text);
  return center ? toPoint(center[1], center[2]) : null;
}

/** 場所URL本体を解析する。経路URL（`/dir/`）は対象外（null）。 */
export function parseGoogleMapsPlaceUrl(input: string): GoogleMapsPlace | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !isGoogleMapsHost(url.hostname)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.includes("dir") || url.searchParams.has("destination")) return null;

  const placeIndex = segments.indexOf("place");
  const search = segments.indexOf("search");
  const fromPath = placeIndex >= 0 ? decode(segments[placeIndex + 1]) : search >= 0 ? decode(segments[search + 1]) : null;
  const queryText = decode(url.searchParams.get("q") ?? url.searchParams.get("query"));
  const raw = fromPath ?? queryText;

  // 座標だけの文字列（`34.8,135.6`）は名前として使わない
  const isCoordinateText = raw !== null && /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(raw);
  const label = raw && !isCoordinateText ? raw : null;
  const coordinates = coordinatesFrom(url, `${url.pathname}${url.search}`);
  if (!label && !coordinates) return null;

  // `名前, 住所` の形は最初のカンマで分ける
  const comma = label ? label.search(/[,、]\s*/) : -1;
  const name = label && comma > 0 ? label.slice(0, comma).trim() : label;
  const address = label && comma > 0 ? label.slice(comma + 1).replace(/^\s+/, "").trim() || null : null;

  return { name, address, coordinates };
}
