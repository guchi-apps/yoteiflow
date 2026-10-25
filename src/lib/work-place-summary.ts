import { toTime } from "@/lib/work-sync/form";

/** 勤務場所の一覧カードに出す要約の材料（issue #1405）。 */
export type PlaceSummaryInput = {
  isTrip: boolean;
  remote: boolean;
  workEnabled: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
  outMinutes: number | null;
  backMinutes: number | null;
};

export type PlaceSummary = {
  /** 出張扱い・在宅扱いのような、場所の性格を示す印。 */
  badges: string[];
  /** 勤務時間・往路復路の要約。 */
  details: string[];
};

/**
 * 一覧カードの要約。詳細を開かなくても、その場所の扱い（出張・在宅）と、勤務時間・往路復路の
 * 所要時間が読めるようにする。在宅の場所は移動を作らないため往路復路を出さない。
 */
export function summarizePlace(input: PlaceSummaryInput): PlaceSummary {
  const badges: string[] = [];
  if (input.isTrip) badges.push("出張扱い");
  if (input.remote) badges.push("在宅扱い");

  const details: string[] = [];
  if (!input.workEnabled) {
    details.push("勤務時間は反映しない");
  } else if (input.startMinutes !== null && input.endMinutes !== null) {
    details.push(`勤務 ${toTime(input.startMinutes)}–${toTime(input.endMinutes)}`);
  } else {
    details.push("勤務 共通の時間");
  }

  if (!input.remote && (input.outMinutes !== null || input.backMinutes !== null)) {
    const minutes = (value: number | null) => (value === null ? "未設定" : `${value}分`);
    details.push(`往路 ${minutes(input.outMinutes)} / 復路 ${minutes(input.backMinutes)}`);
  }

  return { badges, details };
}
