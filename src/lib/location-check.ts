import { containsAddress, matchPlaceByText } from "@/lib/place-text";
import type { PlaceItem } from "@/services/notion/places";

/**
 * 予定の場所が正しく入っているかの判定（issue #1319・docs/spec.md §7）。
 *
 * Morrow など他のアプリは予定の場所欄（location）の文字列から地点を引く。名前だけの
 * 「本社」では地点が決まらないため、住所まで入っているかを見る。
 *
 * - `missing`: 場所が空
 * - `no_address`: 場所はあるが住所が無い（場所DBの住所付きの場所にも当たらない）
 * - `null`: 問題なし、または判定の対象外
 */
export type LocationIssue = "missing" | "no_address";

/** 場所の文字列が住所を持つか。場所DBに住所（か地点）付きで当たる、または文字の中に住所がある。 */
export function hasPlaceAddress(text: string, places: PlaceItem[]): boolean {
  const value = text.trim();
  if (!value) return false;
  if (containsAddress(value)) return true;
  const place = matchPlaceByText(value, places);
  return Boolean(place && (place.address?.trim() || place.coordinates));
}

/**
 * 対象外: 終日の予定（行き先を持たない日の印）・活動記録・書き込めない予定（直せない）・
 * 場所がURL（会議のリンク。地点を持たない予定）。
 */
export function locationIssue(
  event: { allDay: boolean; location: string | null; readOnly: boolean },
  places: PlaceItem[],
  options: { isActivity?: boolean } = {},
): LocationIssue | null {
  if (event.allDay || event.readOnly || options.isActivity) return null;
  const value = event.location?.trim() ?? "";
  if (!value) return "missing";
  if (/^https?:\/\//i.test(value)) return null;
  return hasPlaceAddress(value, places) ? null : "no_address";
}
