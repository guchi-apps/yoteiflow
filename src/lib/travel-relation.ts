/**
 * 移動と予定の時間関係（issue #1137）。往路・復路のフラグではなく、日時だけで決める。
 *
 * - 時刻付き予定の開始以前に移動が到着 → `before`（予定前の移動）
 * - 時刻付き予定の終了以後に移動が出発 → `after`（予定後の移動）
 * - 予定と時間が重なる・終日予定・予定の情報が無い → `related`（前後を断定しない）
 */
export type TravelRelation = "before" | "after" | "related";

export type RelationEvent = {
  start: string;
  end: string;
  /** 省略時は start に時刻（`T`）が無ければ終日とみなす。 */
  allDay?: boolean;
};

export function travelRelation(
  travel: { start: string; end: string },
  event: RelationEvent | null | undefined,
): TravelRelation {
  if (!event) return "related";
  const allDay = event.allDay ?? !event.start.includes("T");
  if (allDay) return "related";

  const departs = Date.parse(travel.start);
  const arrives = Date.parse(travel.end);
  const eventStart = Date.parse(event.start);
  const eventEnd = Date.parse(event.end);
  if ([departs, arrives, eventStart, eventEnd].some(Number.isNaN)) return "related";

  if (arrives <= eventStart) return "before";
  if (departs >= eventEnd) return "after";
  return "related";
}

export const TRAVEL_RELATION_LABELS: Record<TravelRelation, string> = {
  before: "予定前の移動",
  after: "予定後の移動",
  related: "関連する移動",
};

/** 受け取った予定の時刻（任意の3項目）を判定用の形へ。足りない・不正なら null。 */
export function parseRelationEvent(input: {
  eventStart?: unknown;
  eventEnd?: unknown;
  eventAllDay?: unknown;
}): RelationEvent | null {
  const { eventStart, eventEnd, eventAllDay } = input;
  if (typeof eventStart !== "string" || typeof eventEnd !== "string") return null;
  if (!eventStart || !eventEnd) return null;
  return {
    start: eventStart,
    end: eventEnd,
    ...(typeof eventAllDay === "boolean" ? { allDay: eventAllDay } : {}),
  };
}
