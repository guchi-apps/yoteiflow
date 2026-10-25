import { matchPlaceByText } from "@/lib/place-text";
import { isStationPlace } from "@/lib/place-tags";
import type { PlaceItem } from "@/services/notion/places";

/**
 * 予定の場所から最寄り駅までの徒歩（分）。移動の検索時刻に足す（issue #1370・docs/spec.md §29）。
 *
 * Yahoo!乗換案内は場所に最寄り駅があるときだけ駅名で検索する（resolveYahooPlace）。座標・住所での
 * ドアtoドア探索には徒歩が含まれるため、足すと二重になる。最寄り駅が空、または場所そのものが
 * 駅（「駅・空港」タグ）のときは、残っている値も使わず 0 を返す。
 */
export function stationWalkMinutes(location: string | null | undefined, places: PlaceItem[]): number {
  if (!location) return 0;
  const place = matchPlaceByText(location, places);
  if (!place?.station || isStationPlace(place.tags)) return 0;
  return place.stationMinutes ?? 0;
}
