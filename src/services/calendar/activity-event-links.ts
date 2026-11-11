import type { ActivityEventLink } from "@prisma/client";

import { db } from "@/lib/db";
import { listActivityCalendarIds } from "@/services/activity/settings";
import type { ActivityLinkItem, CalendarEventItem } from "@/types/calendar";

/**
 * 活動記録と予定の紐づけ（issue #1514・docs/spec.md §27）。
 *
 * 予定は事前に入れるもの、活動記録は事後に残る事実。両者を結ぶ線だけをDaySpanのDBに持つ
 * （Googleには相手を指す欄が無い。EventOutcome・TaskEventLink と同じ方針）。
 * 記録1件につき予定は1件まで、予定には複数の記録を紐づけられる。
 */

export type ActivityLinkInput = {
  recordCalendarId: string;
  recordEventId: string;
  recordTitle: string;
  recordStart: string;
  recordEnd: string;
  plannedCalendarId: string;
  plannedEventId: string;
  plannedTitle: string;
};

export class ActivityLinkError extends Error {
  constructor(
    readonly code: "invalid_input" | "not_activity_record" | "planned_is_activity",
    message: string,
  ) {
    super(message);
    this.name = "ActivityLinkError";
  }
}

export function toActivityLinkItem(link: ActivityEventLink): ActivityLinkItem {
  return {
    id: link.id,
    recordCalendarId: link.recordCalendarId,
    recordEventId: link.recordEventId,
    recordTitle: link.recordTitle,
    recordStart: link.recordStart.toISOString(),
    recordEnd: link.recordEnd.toISOString(),
    plannedCalendarId: link.plannedCalendarId,
    plannedEventId: link.plannedEventId,
    plannedTitle: link.plannedTitle,
  };
}

/** DaySpanのDBのみ。外部APIへの往復は増えない。 */
export async function listActivityLinks(userId: string): Promise<ActivityEventLink[]> {
  return db.activityEventLink.findMany({ where: { userId } });
}

/**
 * 取得した予定へ紐づけを付ける。表示範囲に両側（または片側）の予定がある場合は、写しではなく
 * 最新の項目名・時間帯で上書きして返す（範囲外は保存時の写しのまま）。
 */
export function attachActivityLinks(
  events: CalendarEventItem[],
  links: ActivityEventLink[],
): CalendarEventItem[] {
  if (links.length === 0) return events;

  const byId = new Map(events.map((event) => [event.id, event]));

  const fresh = (link: ActivityEventLink): ActivityLinkItem => {
    const item = toActivityLinkItem(link);
    const record = byId.get(link.recordEventId);
    if (record && !record.allDay) {
      item.recordTitle = record.title;
      item.recordStart = record.start;
      item.recordEnd = record.end;
    }
    const planned = byId.get(link.plannedEventId);
    if (planned) item.plannedTitle = planned.title;
    return item;
  };

  const forEvent = new Map<string, ActivityLinkItem[]>();
  const push = (eventId: string, item: ActivityLinkItem) => {
    const list = forEvent.get(eventId);
    if (list) list.push(item);
    else forEvent.set(eventId, [item]);
  };
  for (const link of links) {
    const item = fresh(link);
    push(link.recordEventId, item);
    push(link.plannedEventId, item);
  }

  return events.map((event) => {
    const attached = forEvent.get(event.id);
    return attached ? { ...event, activityLinks: attached } : event;
  });
}

/**
 * 紐づける。記録側は活動記録の保存先カレンダーの予定、予定側はそれ以外であることをサーバーで
 * 確かめる（画面から隠すだけだと、APIや将来のMCPから任意の予定どうしを結べてしまう）。
 */
export async function setActivityLink(
  userId: string,
  input: ActivityLinkInput,
): Promise<ActivityEventLink> {
  const start = new Date(input.recordStart);
  const end = new Date(input.recordEnd);
  if (
    !input.recordEventId ||
    !input.plannedEventId ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    throw new ActivityLinkError("invalid_input", "紐づけの指定が正しくありません。");
  }

  const activityCalendarIds = await listActivityCalendarIds(userId);
  if (!activityCalendarIds.includes(input.recordCalendarId)) {
    throw new ActivityLinkError("not_activity_record", "活動記録の予定ではありません。");
  }
  if (activityCalendarIds.includes(input.plannedCalendarId)) {
    throw new ActivityLinkError("planned_is_activity", "活動記録どうしは紐づけられません。");
  }

  const data = {
    recordCalendarId: input.recordCalendarId,
    recordTitle: input.recordTitle.slice(0, 191),
    recordStart: start,
    recordEnd: end,
    plannedCalendarId: input.plannedCalendarId,
    plannedEventId: input.plannedEventId,
    plannedTitle: input.plannedTitle.slice(0, 191),
  };

  return db.activityEventLink.upsert({
    where: { userId_recordEventId: { userId, recordEventId: input.recordEventId } },
    create: { userId, recordEventId: input.recordEventId, ...data },
    update: data,
  });
}

/** 紐づけを外す（記録・予定は残る）。 */
export async function clearActivityLink(userId: string, linkId: string): Promise<number> {
  const result = await db.activityEventLink.deleteMany({ where: { userId, id: linkId } });
  return result.count;
}

/**
 * 予定の移動時に、予定側・記録側が持つカレンダーの写しも合わせる。引き当ては eventId で行う。
 */
export async function moveActivityLinkCalendar(
  userId: string,
  eventId: string,
  calendarId: string,
): Promise<void> {
  await db.activityEventLink.updateMany({
    where: { userId, plannedEventId: eventId },
    data: { plannedCalendarId: calendarId },
  });
  await db.activityEventLink.updateMany({
    where: { userId, recordEventId: eventId },
    data: { recordCalendarId: calendarId },
  });
}

/**
 * 予定・記録を消したときに、指す先が無くなる紐づけを消す。記録側・予定側のどちらの eventId が
 * 一致しても消す。繰り返しの範囲指定は `dropOutcomesForEvent()` と同じ（回のIDは
 * `<親のID>_YYYYMMDDTHHMMSSZ` で桁が揃っており、文字列の大小で前後を比べられる）。
 */
export async function dropActivityLinksForEvent(
  userId: string,
  eventId: string,
  scope: "single" | "following" | "all",
): Promise<number> {
  const separator = eventId.indexOf("_");

  if (scope === "single" || separator < 0) {
    const result = await db.activityEventLink.deleteMany({
      where: { userId, OR: [{ recordEventId: eventId }, { plannedEventId: eventId }] },
    });
    return result.count;
  }

  const prefix = `${eventId.slice(0, separator)}_`;
  const range = scope === "all" ? { startsWith: prefix } : { startsWith: prefix, gte: eventId };
  const result = await db.activityEventLink.deleteMany({
    where: { userId, OR: [{ recordEventId: range }, { plannedEventId: range }] },
  });
  return result.count;
}
