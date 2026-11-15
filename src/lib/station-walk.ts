import { matchPlaceByText } from "@/lib/place-text";
import { isStationPlace } from "@/lib/place-tags";
import { chooseStation, placeStations, type StationChoice } from "@/lib/station-name";
import type { PlaceItem } from "@/services/notion/places";

/**
 * 予定の場所から最寄り駅までの徒歩（分）。移動の検索時刻に足す（issue #1370・docs/spec.md §29）。
 *
 * Yahoo!乗換案内は場所に最寄り駅があるときだけ駅名で検索する（resolveYahooPlace）。座標・住所での
 * ドアtoドア探索には徒歩が含まれるため、足すと二重になる。最寄り駅が空、または場所そのものが
 * 駅（「駅・空港」タグ）のときは、残っている値も使わず 0 を返す。
 *
 * 最寄り駅が複数あるときは `station` で選んだ駅（省略時は先頭）の徒歩を返し、`null`（地点で探す）は 0
 * （issue #1607）。
 */
export function stationWalkMinutes(
  location: string | null | undefined,
  places: PlaceItem[],
  station?: StationChoice,
): number {
  if (!location) return 0;
  const place = matchPlaceByText(location, places);
  if (!place || isStationPlace(place.tags)) return 0;
  return chooseStation(placeStations(place), station)?.minutes ?? 0;
}
