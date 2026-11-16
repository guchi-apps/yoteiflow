import type { Snapshot } from "@/lib/work-sync/decide";
import type { WorkRecordOverride } from "@/lib/work-sync/plan";

/**
 * カレンダーで直した勤務予定の時刻を、勤務記録ごとの指定へ書き戻す判定（docs/spec.md §46・issue #1618）。
 * DBにも外部APIにも触らない純粋関数。
 */

export type EditedWorkEvent = {
  start: string;
  end: string;
  title: string;
  location: string | null | undefined;
  description: string | null | undefined;
};

/** タイムゾーンでの日付（YYYY-MM-DD）と0時からの分。分単位でない時刻は null。 */
export function zonedDateMinutes(
  iso: string,
  timeZone: string,
): { date: string; minutes: number } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.getTime() % 60_000 !== 0) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export type ReflectTarget = { date: string; startMinutes: number; endMinutes: number };

/**
 * 反映できる編集か。時刻だけを直した（タイトル・場所・メモは控えのまま）、同じ日の中の、
 * 分単位の変更に限る。それ以外は従来どおり手動調整として扱う（書き戻さない）。
 */
export function reflectTarget(
  snapshot: Snapshot,
  rowDate: string,
  edit: EditedWorkEvent,
  timeZone: string,
): ReflectTarget | null {
  if (
    edit.title !== (snapshot.title ?? "") ||
    (edit.location ?? "") !== (snapshot.location ?? "") ||
    (edit.description ?? "") !== (snapshot.description ?? "")
  ) {
    return null;
  }
  const start = zonedDateMinutes(edit.start, timeZone);
  const end = zonedDateMinutes(edit.end, timeZone);
  if (!start || !end) return null;
  if (start.date !== rowDate || end.date !== rowDate) return null;
  if (end.minutes <= start.minutes) return null;
  return { date: rowDate, startMinutes: start.minutes, endMinutes: end.minutes };
}

/**
 * 記録ごとの指定へ新しい勤務時間を組み込む。期間の記録・すでにその日の指定がある記録は
 * `days[日付]`（`startMinutes/endMinutes` より優先されるため）、単日の記録は `startMinutes/endMinutes`。
 */
export function applyEventTime(
  override: WorkRecordOverride | null,
  record: { startDate: string; endDate: string },
  target: ReflectTarget,
): WorkRecordOverride {
  const next: WorkRecordOverride = { ...(override ?? {}) };
  const multiDay = record.startDate !== record.endDate;
  if (multiDay || next.days?.[target.date]) {
    next.days = {
      ...next.days,
      [target.date]: { start: target.startMinutes, end: target.endMinutes },
    };
  } else {
    next.startMinutes = target.startMinutes;
    next.endMinutes = target.endMinutes;
  }
  return next;
}
