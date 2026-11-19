import { isStationPlace } from "@/lib/place-tags";
import { placeStations } from "@/lib/station-name";
import type { PlaceItem } from "@/services/notion/places";

/**
 * 勤務先の登録画面で、最寄り駅からの徒歩分を徒歩欄の初期値に使うための純粋関数（issue #1707）。
 * 場所DB（`PlaceItem.stations`）を読むだけで、保存するのは利用者が保存を押したときの欄の値だけ。
 */

/** 勤務場所に対応する場所DBの1件。正式名称の紐づけ先を優先し、無ければ同じ名前の場所。 */
export function placeForWorkPlace(
  workPlace: string,
  linkedPlaceId: string | null,
  places: PlaceItem[],
): PlaceItem | null {
  if (linkedPlaceId) {
    const linked = places.find((place) => place.id === linkedPlaceId);
    if (linked) return linked;
  }
  return places.find((place) => place.name === workPlace) ?? null;
}

/** 最寄り駅（先頭の駅）までの徒歩分。駅そのものの場所・駅が未登録・分が不明なら null。 */
export function nearestStationWalk(place: PlaceItem | null): number | null {
  if (!place || isStationPlace(place.tags)) return null;
  return placeStations(place)[0]?.minutes ?? null;
}

/** 先頭の最寄り駅名。駅そのものの場所・未登録なら null。 */
export function nearestStationName(place: PlaceItem | null): string | null {
  if (!place || isStationPlace(place.tags)) return null;
  return placeStations(place)[0]?.name ?? null;
}

/** 欄の初期値。保存済みの値があればそれ、無ければ最寄り駅の徒歩分、どちらも無ければ空。 */
export function initialWalkText(saved: number | null | undefined, station: number | null): string {
  if (saved !== null && saved !== undefined) return String(saved);
  return station === null ? "" : String(station);
}

/** 往路・復路の徒歩（電車の前後の合計）の初期値。自宅側と勤務先側のわかる分を足す。 */
export function initialLegWalkText(savedWalk: number | null | undefined, homeWalk: number | null, placeWalk: number | null): string {
  // 保存済みの行があれば0分も有効値としてそのまま使う（最寄り駅で置き換えない）。
  if (savedWalk !== null && savedWalk !== undefined) return savedWalk > 0 ? String(savedWalk) : "0";
  if (homeWalk === null && placeWalk === null) return "";
  return String((homeWalk ?? 0) + (placeWalk ?? 0));
}
