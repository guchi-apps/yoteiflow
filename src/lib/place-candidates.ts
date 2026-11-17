/**
 * 地図から場所を登録するときの名前候補（issue #1676）。
 * ネット（OSM）の候補とAIの候補を、名前と住所の組で重複を除いて1つの一覧にする。
 */

export type PlaceCandidate = {
  name: string;
  address: string | null;
  /** 地点が分かっているときだけ。無ければ選んだあとに住所から引く。 */
  coordinates: { lat: number; lng: number } | null;
  source: "map" | "ai";
};

/** 先に来たものを残す。名前の前後の空白・大文字小文字・住所の有無の違いだけの重複を落とす。 */
export function mergePlaceCandidates(lists: PlaceCandidate[][], max = 5): PlaceCandidate[] {
  const seen = new Set<string>();
  const names = new Set<string>();
  const result: PlaceCandidate[] = [];
  for (const candidate of lists.flat()) {
    const name = candidate.name.trim();
    if (!name) continue;
    const nameKey = name.toLowerCase();
    const key = `${nameKey}|${(candidate.address ?? "").replace(/\s+/g, "")}`;
    // 住所の無い候補は、同じ名前がすでにあれば足さない（情報が増えないため）。
    if (seen.has(key) || (!candidate.address && names.has(nameKey))) continue;
    seen.add(key);
    names.add(nameKey);
    result.push({ ...candidate, name });
    if (result.length >= max) break;
  }
  return result;
}
