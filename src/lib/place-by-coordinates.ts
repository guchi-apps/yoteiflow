import { parseCoordinates, type LatLng } from "@/lib/coordinates";
import { toLocationText } from "@/lib/place-text";
import type { PlaceItem } from "@/services/notion/places";

/** 座標だけの地点を、登録済みの場所とみなす距離（m）。Googleの保存地点と地図で選んだ座標は数十mずれる */
export const PLACE_MATCH_METERS = 100;

function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * 座標だけの文字列（`34.841753,135.61853`）を、近くにある登録済みの場所の `名前 住所` へ直す（issue #1197）。
 * Googleマップの共有経路は「自宅」のような保存地点を座標で渡すため、そのままでは画面に座標が出る。
 * 座標でない値・近くに場所が無い値は null（呼び出し側が元の文字列を使う）。いちばん近い場所を採る。
 */
export function placeTextForCoordinates(text: string, places: PlaceItem[]): string | null {
  const point = parseCoordinates(text);
  if (!point) return null;
  let best: { place: PlaceItem; meters: number } | null = null;
  for (const place of places) {
    if (!place.coordinates) continue;
    const meters = distanceMeters(point, place.coordinates);
    if (meters <= PLACE_MATCH_METERS && (!best || meters < best.meters)) best = { place, meters };
  }
  return best ? toLocationText(best.place.name, best.place.address) : null;
}
