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
}): string | null {
  const destination = pointParam(input.destination, input.places);
  if (!destination) return null;

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
