import type { PlaceItem } from "@/services/notion/places";

/**
 * 勤務場所の住所に選べる候補（issue #1343）。
 *
 * 住所を持つ場所だけを、住所の重複を落として並べる（同じ住所の別名が並んでも選ぶ材料にならない）。
 * 並びは場所DBのまま。
 */
export function addressCandidates(places: PlaceItem[], excludeName: string): PlaceItem[] {
  const seen = new Set<string>();
  const result: PlaceItem[] = [];
  for (const place of places) {
    const address = place.address?.trim();
    if (!address || place.name === excludeName) continue;
    if (seen.has(address)) continue;
    seen.add(address);
    result.push(place);
  }
  return result;
}
