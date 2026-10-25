import { isPartialLeave, type WorkRecordItem } from "@/types/work";

/**
 * 狭い列に出す1文字（issue #1381）。「どこにいるか」がひと目で分かることを優先する。
 *
 * - 全休・会社休業日: 「休」
 * - 半休・時間休: 残りの勤務場所の1文字（無ければ区分の先頭1文字）
 * - 出張: 行き先の先頭1文字
 * - 通常の勤務: 設定した1文字。未設定は勤務場所の先頭1文字
 */
export function workShortLabel(
  record: WorkRecordItem,
  shortLabels: Record<string, string>,
): string {
  if (record.companyHoliday) return "休";
  if (record.annualLeave) {
    if (!isPartialLeave(record.annualLeave)) return "休";
    if (!record.place) return firstCharacter(record.annualLeave);
    return shortLabels[record.place] ?? firstCharacter(record.place);
  }
  if (record.businessTrip) return firstCharacter(record.title);
  const place = record.place ?? record.title;
  return shortLabels[place] ?? firstCharacter(place);
}

function firstCharacter(value: string): string {
  const [first] = new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(value.trim());
  return first?.segment ?? "";
}


/** 見た目の1文字か（絵文字や結合文字も1文字と数える）。 */
export function isSingleCharacter(value: string): boolean {
  return [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(value)].length === 1;
}
