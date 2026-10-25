/** 絞り込みに使う場所の項目。`PlaceItem` のうち読むものだけ。 */
export type FilterablePlace = {
  name: string;
  address?: string | null;
  station?: string | null;
  tags: string[];
};

/**
 * 場所を検索語とタグで絞る（issue #1363）。
 *
 * 検索語は名前・住所・最寄り駅・タグへの部分一致。タグは複数選んだとき「いずれかが付いている」
 * 場所を残し（OR）、検索語とは掛け合わせる（両方に当たるものだけ）。並びは元のまま。
 */
export function filterPlaces<T extends FilterablePlace>(
  places: T[],
  query: string,
  selectedTags: readonly string[],
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle && selectedTags.length === 0) return places;

  return places.filter((place) => {
    if (selectedTags.length > 0 && !place.tags.some((tag) => selectedTags.includes(tag))) {
      return false;
    }
    if (!needle) return true;
    return [place.name, place.address ?? "", place.station ?? "", ...place.tags]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}
