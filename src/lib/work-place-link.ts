import type { PlaceItem } from "@/services/notion/places";

/** 勤務場所ごとの正式名称の場所と省略名（issue #1382・docs/spec.md §46）。 */
export type WorkPlaceLinkRow = {
  workPlace: string;
  placeId: string | null;
  shortLabel2: string | null;
  shortLabel1: string | null;
};

/**
 * 場所一覧に、勤務場所の名前で引ける別名エントリを足す。
 *
 * 結び付け先の住所・座標・最寄り駅を、勤務場所の名前の場所として見せる。場所DBへは書かない。
 * 同名の場所がすでにあれば置き換える（住所の無い同名の場所が先に引かれ、結び付けが効かなくなるのを防ぐ。
 * `matchPlaceByText` は一覧の先に見つかったものを返すため、別名を先頭に置く）。
 * 結び付け先が一覧に無い（削除された）行は何もしない＝未登録に戻る。
 */
export function withWorkPlaceLinks(places: PlaceItem[], links: WorkPlaceLinkRow[]): PlaceItem[] {
  const aliases: PlaceItem[] = [];
  for (const link of links) {
    const target = link.placeId ? places.find((place) => place.id === link.placeId) : undefined;
    if (!target) continue;
    aliases.push({ ...target, name: link.workPlace });
  }
  if (aliases.length === 0) return places;
  const names = new Set(aliases.map((alias) => alias.name));
  return [...aliases, ...places.filter((place) => !names.has(place.name))];
}
