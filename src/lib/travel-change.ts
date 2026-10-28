import { placeDisplayName } from "@/lib/place-text";
import { GENERATED_NOTE } from "@/lib/work-generated-note";

/**
 * 移動の変更シート（issue #1466）の純粋な計算。DBにも外部APIにも触らない。
 */

export type FixedSide = "depart" | "arrive";

/** 所要分を変えたとき、固定した側を動かさず反対側を求める。 */
export function applyDuration(
  fixed: FixedSide,
  startIso: string,
  endIso: string,
  minutes: number,
): { start: string; end: string } {
  const span = minutes * 60_000;
  if (fixed === "arrive") {
    return { start: new Date(new Date(endIso).getTime() - span).toISOString(), end: endIso };
  }
  return { start: startIso, end: new Date(new Date(startIso).getTime() + span).toISOString() };
}

/** 保存済みの出発地・目的地（`名前 住所`のことがある）と設定の行のキーを同じ地点として照合するための正規化。 */
export function normalizePlaceKey(text: string): string {
  return placeDisplayName(text).trim();
}

export function samePair(
  travel: { origin: string; destination: string },
  row: { origin: string; destination: string },
): boolean {
  return (
    normalizePlaceKey(travel.origin) === normalizePlaceKey(row.origin) &&
    normalizePlaceKey(travel.destination) === normalizePlaceKey(row.destination)
  );
}

/** 登録済みの電車の時刻を、移動のある日（日付キー）の壁時計の分へ。到着は出発 + 所要分（日をまたぎうる）。 */
export function trainWallTimes(
  departMinutes: number,
  durationMinutes: number,
): { depart: number; arrive: number } {
  return { depart: departMinutes, arrive: departMinutes + durationMinutes };
}

/** 自動生成の定型メモだけを外す。利用者が書いたメモ・取り込んだ経路テキストは残す。 */
export function dropGeneratedNote(note: string | null): string | null {
  return note === GENERATED_NOTE ? null : note;
}
