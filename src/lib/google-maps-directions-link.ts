/**
 * 移動の出発地・目的地を入れた状態で Googleマップの経路画面を開くURLを組み立てる（issue #1225）。
 *
 * Google Maps URLs の `dir` の形（`?api=1&origin=&destination=&travelmode=`）にする。スマートフォンでは
 * Googleマップのアプリが入っていればアプリが開く（`mapLink()` の検索と同じ）。
 *
 * 地点は場所DBに当たれば座標、無ければ住所、それも無ければ場所欄の文字列そのまま渡す。
 * `名前 住所` を丸ごと渡すと別の場所が当たることがあるため、Yahoo!乗換案内と同じく
 * 場所DBを先に引く（`resolveMapStart()` と同じ順序）。
 */

import type { PlaceItem } from "@/services/notion/places";
import type { TravelMode } from "@/types/calendar";

import { matchPlaceByText, splitNameAndAddress } from "@/lib/place-text";

const GOOGLE_MAPS_DIR = "https://www.google.com/maps/dir/?api=1";

const TRAVEL_MODE_PARAM: Record<TravelMode, string | null> = {
  CAR: "driving",
  PUBLIC_TRANSIT: "transit",
  WALK: "walking",
  // 自転車などGoogleの区分に素直に当たらないものは指定せず、Googleマップの既定に任せる
  OTHER: null,
};

function pointParam(text: string, places: PlaceItem[]): string | null {
  const value = text.trim();
  if (!value) return null;

  const place = matchPlaceByText(value, places);
  if (place) {
    if (place.coordinates) return `${place.coordinates.lat},${place.coordinates.lng}`;
    return place.address ?? place.name;
  }
  return splitNameAndAddress(value)?.address ?? value;
}

// `!3e` は読み取り側（google-maps-route.ts）と同じ対応。その他は指定せずGoogleマップの既定に任せる
const DATA_MODE: Record<TravelMode, string | null> = { CAR: "0", WALK: "2", PUBLIC_TRANSIT: "3", OTHER: null };

/**
 * 日時つきのURL。公式の `dir/?api=1` には日時の指定が無いため、共有URLと同じ
 * `/maps/dir/<出発>/<経由>/<到着>/data=!4m6!4m5!2m3!6e<0出発|1到着>!7e2!8j<時刻>` の形にする（非公式）。
 * `!8j` は現地の壁時計をUTCとして数えた値（読み取り側 `dataSchedule()` と同じ・issue #1160）。
 * 日時が読めなければ null（呼び出し側が日時なしのURLへ落とす）。
 */
function scheduledLink(
  input: { origin: string; via?: string[]; mode: TravelMode; places: PlaceItem[] },
  destination: string,
  schedule: { at: string; basis: "depart" | "arrive" },
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(schedule.at)) return null;
  const ms = Date.parse(`${schedule.at}:00Z`);
  if (Number.isNaN(ms)) return null;

  const segment = (value: string | null) => (value ? encodeURIComponent(value) : "");
  const path = [
    segment(pointParam(input.origin, input.places)),
    ...(input.via ?? []).map((item) => segment(pointParam(item, input.places))).filter(Boolean),
    segment(destination),
  ].join("/");
  const mode = DATA_MODE[input.mode];
  const data = `!4m6!4m5!2m3!6e${schedule.basis === "arrive" ? 1 : 0}!7e2!8j${Math.floor(ms / 1000)}${mode ? `!3e${mode}` : ""}`;
  return `https://www.google.com/maps/dir/${path}/data=${data}`;
}

/**
 * 経路画面を開くURL。目的地が決まらなければ null。
 * 出発地が空のときは `origin` を付けず、Googleマップ側の現在地に任せる。
 */
export function googleMapsDirectionsLink(input: {
  origin: string;
  destination: string;
  via?: string[];
  mode: TravelMode;
  places: PlaceItem[];
  /** 検索する日時（設定タイムゾーンの壁時計 `YYYY-MM-DDTHH:mm`）と、その日時を出発・到着のどちらとして探すか（issue #1653） */
  schedule?: { at: string; basis: "depart" | "arrive" };
}): string | null {
  const destination = pointParam(input.destination, input.places);
  if (!destination) return null;

  if (input.schedule) {
    const scheduled = scheduledLink(input, destination, input.schedule);
    if (scheduled) return scheduled;
  }

  const params = [`destination=${encodeURIComponent(destination)}`];
  const origin = pointParam(input.origin, input.places);
  if (origin) params.push(`origin=${encodeURIComponent(origin)}`);

  const waypoints = (input.via ?? [])
    .map((item) => pointParam(item, input.places))
    .filter((item): item is string => item !== null);
  if (waypoints.length > 0) params.push(`waypoints=${encodeURIComponent(waypoints.join("|"))}`);

  const mode = TRAVEL_MODE_PARAM[input.mode];
  if (mode) params.push(`travelmode=${mode}`);

  return `${GOOGLE_MAPS_DIR}&${params.join("&")}`;
}
