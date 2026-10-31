import { matchPlaceByText } from "@/lib/place-text";
import type { PlaceItem } from "@/services/notion/places";

/** 勤務場所ごとの徒歩（`WorkPlaceDefault.walkHomeMinutes/walkPlaceMinutes`・issue #1471）。null は共通値。 */
export type PlaceWalkRow = {
  key: string;
  /** 出張扱いの行か（同名で通常の行と出張の行が両方ありうる。issue #1475） */
  isTrip?: boolean;
  walkHomeMinutes: number | null;
  walkPlaceMinutes: number | null;
};

/**
 * 出発地・目的地の文字列から、その経路で電車の前後に足す徒歩を決める。
 *
 * `places` は `withWorkPlaceLinks()` を通した一覧で、勤務場所の名前で引ける別名を含む。
 * 目的地が勤務場所なら「前＝自宅側・後＝勤務先側」、出発地が勤務場所なら逆。どちらも勤務場所
 * （または両方とも違う）なら決められないので null を返し、呼び出し元は共通値のままにする。
 * 勤務場所の指定が片方だけのときも、空の側は共通値へ落とす。出張扱いの場所（`tripPlaces`）は出張の行を、
 * 通常の場所は通常の行を引く。
 */
export function resolvePlaceWalk(
  origin: string,
  destination: string,
  places: PlaceItem[],
  rows: PlaceWalkRow[],
  fallback: { before: number; after: number },
  tripPlaces: string[] = [],
): { before: number; after: number } | null {
  const workPlaceOf = (text: string): PlaceWalkRow | null => {
    const match = matchPlaceByText(text, places);
    if (!match) return null;
    // 同名の出張行と通常行が両方残っていても、今の分類（出張扱いか）に合う行だけを使う。
    // もう一方へ落とすと、切り替え前の古い値が黙って使われる（issue #1475）。
    const trip = tripPlaces.includes(match.name);
    return rows.find((row) => row.key === match.name && Boolean(row.isTrip) === trip) ?? null;
  };
  const from = workPlaceOf(origin);
  const to = workPlaceOf(destination);
  if (Boolean(from) === Boolean(to)) return null;
  const target = (to ?? from) as PlaceWalkRow;
  const home = target.walkHomeMinutes;
  const place = target.walkPlaceMinutes;
  if (home === null && place === null) return null;
  const [before, after] = to ? [home, place] : [place, home];
  return { before: before ?? fallback.before, after: after ?? fallback.after };
}
