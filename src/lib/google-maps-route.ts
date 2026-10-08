/**
 * Googleマップで共有された経路URLから、移動入力欄へ反映できる値を読む（docs/spec.md §29）。
 *
 * Google Maps URLsの経路指定（`origin`・`destination`・`travelmode`）、モバイル共有で使われる
 * `/maps/dir/`のdataパラメータ、iOSの経路共有の短縮URLが展開される旧形式
 * （`maps.google.com/?saddr=…&daddr=…&dirflg=d`・issue #1142）を読む。
 * URL形式はGoogle側のものなので、読めない部分は推測せずnullにする。
 */

import type { TravelMode } from "@/types/calendar";

const GOOGLE_HOSTS = new Set(["google.com", "www.google.com", "maps.google.com", "maps.app.goo.gl"]);

/** 経由地として読む上限。Googleマップの経路指定も複数地点は少数で、長い連なりは読まない */
export const MAX_WAYPOINTS = 5;

export type GoogleMapsRoute = {
  origin: string;
  destination: string;
  /** 出発地と目的地の間の経由地（順番どおり）。無ければ空配列（issue #1197） */
  waypoints: string[];
  mode: TravelMode;
  /** AIが共有経路の情報から補完した所要時間（分）。URL自身には無いため、補完できなければnull。 */
  minutes: number | null;
  /** Googleマップで指定された出発／到着日時（現地の壁時計）。指定が無いときはnull。 */
  schedule: GoogleMapsSchedule | null;
};

export type GoogleMapsSchedule = {
  basis: "depart" | "arrive";
  /** 現地の壁時計 `YYYY-MM-DDTHH:mm`（タイムゾーンは別に決める） */
  local: string;
};

/** リダイレクトを追跡してよいGoogle Mapsのホストか。 */
export function isGoogleMapsHost(hostname: string): boolean {
  return GOOGLE_HOSTS.has(hostname.toLowerCase());
}

function routeMode(value: string | null): TravelMode {
  switch (value?.toLowerCase()) {
    case "transit":
      return "PUBLIC_TRANSIT";
    case "walking":
      return "WALK";
    case "bicycling":
      return "OTHER";
    default:
      return "CAR";
  }
}

/** 旧形式の `dirflg`（d=車・r=公共交通・w=徒歩・b=自転車）。 */
function dirflgMode(value: string | null): TravelMode | null {
  switch (value?.toLowerCase()) {
    case "d":
      return "CAR";
    case "r":
      return "PUBLIC_TRANSIT";
    case "w":
      return "WALK";
    case "b":
      return "OTHER";
    default:
      return null;
  }
}

function dataMode(data: string): TravelMode | null {
  const value = /!3e([0-3])(?:!|$)/.exec(data)?.[1];
  switch (value) {
    case "0":
      return "CAR";
    case "1":
      return "OTHER";
    case "2":
      return "PUBLIC_TRANSIT";
    case "3":
      return "WALK";
    default:
      return null;
  }
}

/**
 * 指定日時。`!6e0`=出発指定、`!6e1`=到着指定（`!6e`が無く`!8j`だけのものは出発指定として扱う）。
 * `!8j` は通常のUNIX時刻ではなく、**現地の壁時計をUTCとして数えた値**（14:08出発が1791382080＝UTCの14:08。
 * 実リンクで確認・issue #1160）。実際の時刻へ直すのはタイムゾーンが分かる側（`google-maps-directions.ts`）で行い、
 * ここでは壁時計（`YYYY-MM-DDTHH:mm`）のまま持つ。固定の時差は足し引きしない。
 */
function dataSchedule(data: string): GoogleMapsSchedule | null {
  const value = /!8j(\d{10,13})(?:!|$)/.exec(data)?.[1];
  if (!value) return null;
  const basisCode = /!6e(\d)!7e\d+!8j/.exec(data)?.[1];
  // 0=出発・1=到着。それ以外（未知の値）は意味を断定できないため日時ごと読まない
  if (basisCode !== undefined && basisCode !== "0" && basisCode !== "1") return null;

  const date = new Date(Number(value) * (value.length === 10 ? 1_000 : 1));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) return null;
  return { basis: basisCode === "1" ? "arrive" : "depart", local: date.toISOString().slice(0, 16) };
}

function place(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded && decoded.length <= 500 ? decoded : null;
  } catch {
    return null;
  }
}

function googleMapsUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  return url.protocol === "https:" && isGoogleMapsHost(url.hostname) ? url : null;
}

/**
 * 経路を指すURLか（発着地が揃っているかは問わない）。目的地だけの経路（出発地＝現在地）を
 * 場所の共有と取り違えて予定の場所へ入れないために、場所の解析より先に見る（issue #1142）。
 */
export function isGoogleMapsRouteUrl(input: string): boolean {
  const url = googleMapsUrl(input);
  if (!url) return false;
  const segments = url.pathname.split("/").filter(Boolean);
  return (
    segments.includes("dir") ||
    url.searchParams.has("destination") ||
    url.searchParams.has("daddr") ||
    url.searchParams.has("saddr")
  );
}

/** 経路URL本体を解析する。短縮URLの展開はAPIルートが担当する。 */
export function parseGoogleMapsRouteUrl(input: string): GoogleMapsRoute | null {
  const url = googleMapsUrl(input);
  if (!url) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const dirIndex = segments.findIndex((segment) => segment === "dir");
  // `/dir/` の後ろは `出発地/(経由地/)*目的地/data=…`。`data=`・`@座標,ズーム`は地点ではない
  const pathPlaces =
    dirIndex >= 0
      ? segments
          .slice(dirIndex + 1)
          .filter((segment) => !segment.startsWith("data=") && !segment.startsWith("@"))
          .map((segment) => place(segment.replace(/\+/g, " ")))
      : [];
  const pathOrigin = pathPlaces[0] ?? null;
  const pathDestination = pathPlaces.length >= 2 ? pathPlaces[pathPlaces.length - 1] : null;
  // 読めない（null）地点が途中に混ざるときは順序を保証できないため、経由地ごと読まない
  const pathVia = pathPlaces.length > 2 ? pathPlaces.slice(1, -1) : [];
  const waypoints = pathVia.every((item): item is string => item !== null) ? (pathVia as string[]).slice(0, MAX_WAYPOINTS) : [];
  // 座標だけの出発地（`saddr=34.84,135.61`）も名称が無いまま文字列で保持する
  const origin = place(url.searchParams.get("origin")) ?? place(url.searchParams.get("saddr")) ?? pathOrigin;
  const destination = place(url.searchParams.get("destination")) ?? place(url.searchParams.get("daddr")) ?? pathDestination;
  if (!origin || !destination || origin === "data=" || destination === "data=") return null;

  const data = url.searchParams.get("data") ?? url.pathname.match(/\/data=([^?]+)/)?.[1] ?? "";
  return {
    origin,
    destination,
    waypoints: url.searchParams.has("origin") || url.searchParams.has("saddr") ? [] : waypoints,
    mode: dataMode(data) ?? dirflgMode(url.searchParams.get("dirflg")) ?? routeMode(url.searchParams.get("travelmode")),
    // URL自身には所要時間が無いため、APIルートでAI解析後に入れる。
    minutes: null,
    schedule: dataSchedule(data),
  };
}
