import type { EventNotificationSetting } from "@prisma/client";

import { normalizeLeadMinutes } from "@/lib/event-notification";
import { db } from "@/lib/db";
import type { CalendarEventItem, EventNotificationOverride } from "@/types/calendar";

/**
 * 予定ごとの通知設定（issue #708）。
 *
 * アカウント単位の設定（NotificationSetting.eventLeadMinutes）は全予定に一律で適用される。
 * この予定だけ通知したくない・複数回通知したい、という要望には応えられない。Googleの予定には
 * reminders欄があるが、それはGoogleカレンダー自身の通知（popup/email）向けの欄で、DaySpanが
 * 送るWeb Push通知の下書き（NotificationJob）の計算には使えない。EventOutcome・
 * TaskEventLink・TravelPlanと同じく、相手のDBに欄が無いものは線だけをDaySpanが持つ。
 */

/**
 * 移動の通知設定のキー（issue #1112）。移動はDaySpanのDBにありGoogleの予定IDを持たないため、
 * 予定と同じ表（EventNotificationSetting）へ `travel:<移動ID>` で置く。Googleの予定IDは
 * 英数字のみで `:` を含まないため衝突しない。calendarId は空文字（TaskEventLink が移動を
 * 指すときと同じ流儀）。
 */
export function travelNotificationKey(travelId: string): string {
  return `travel:${travelId}`;
}

export class EventNotificationSettingsError extends Error {}

export type EventNotificationSettingInput = {
  calendarId: string;
  eventId: string;
  enabled: boolean;
  leadMinutes: number[];
};

/**
 * この利用者の設定をすべて引く。
 *
 * 範囲で絞らないのは、`eventId` からは日付が引けないため。予定ごとの上書きは稀にしか
 * 起きず、件数は現実的に増えない（`listEventOutcomes()` と同じ扱い）。DaySpanのDBのみの
 * ため、外部APIへの往復は増えない。
 */
export async function listEventNotificationSettings(
  userId: string,
): Promise<EventNotificationSetting[]> {
  return db.eventNotificationSetting.findMany({ where: { userId } });
}

export async function getEventNotificationSetting(
  userId: string,
  eventId: string,
): Promise<EventNotificationSetting | null> {
  return db.eventNotificationSetting.findUnique({ where: { userId_eventId: { userId, eventId } } });
}

/** DBの行を画面が扱う形へ。 */
export function toEventNotificationOverride(
  setting: EventNotificationSetting,
): EventNotificationOverride {
  return {
    enabled: setting.enabled,
    leadMinutes: (setting.leadMinutes as number[]) ?? [],
  };
}

/**
 * 取得した予定へ上書き設定を付ける。設定の無い予定は `toCalendarItems()` が入れた null のまま
 * 残す（アカウント既定に従う）。
 */
export function attachEventNotificationSettings(
  events: CalendarEventItem[],
  settings: EventNotificationSetting[],
): CalendarEventItem[] {
  if (settings.length === 0) return events;

  const byEventId = new Map(settings.map((setting) => [setting.eventId, setting]));

  return events.map((event) => {
    const setting = byEventId.get(event.id);
    return setting ? { ...event, notification: toEventNotificationOverride(setting) } : event;
  });
}

/**
 * 上書き設定を付ける・付け替える。予定1件につき1つのため、選び直したら上書きになる。
 * 設定はGoogleへ書き込まないため、「使用」がオフのカレンダーの予定にも付けられる
 * （タスクの紐づけ・中止不参加の記録と同じ判断）。
 */
export async function setEventNotificationSetting(
  userId: string,
  input: EventNotificationSettingInput,
): Promise<EventNotificationSetting> {
  const leadMinutes = normalizeLeadMinutes(input.leadMinutes);

  if (input.enabled && leadMinutes.length === 0) {
    throw new EventNotificationSettingsError("何分前に知らせるかを1つ以上選んでください。");
  }

  const setting = await db.eventNotificationSetting.upsert({
    where: { userId_eventId: { userId, eventId: input.eventId } },
    create: {
      userId,
      calendarId: input.calendarId,
      eventId: input.eventId,
      enabled: input.enabled,
      leadMinutes,
    },
    // カレンダーは予定を移すと変わる。設定は予定IDで引くため、写しのほうを合わせる。
    update: { calendarId: input.calendarId, enabled: input.enabled, leadMinutes },
  });

  await replanNotifications(userId);

  return setting;
}

/** 上書きを外す。アカウント既定に従う状態へ戻る。 */
export async function clearEventNotificationSetting(
  userId: string,
  eventId: string,
): Promise<number> {
  const result = await db.eventNotificationSetting.deleteMany({ where: { userId, eventId } });
  if (result.count > 0) await replanNotifications(userId);
  return result.count;
}

/**
 * 予定を別のカレンダーへ移したときに、設定が持つカレンダーの写しも合わせる。
 *
 * 引き当てには使わない（`eventId` で引く）が、持っている値が古いままだと「どのカレンダーの
 * 予定だったか」を設定が偽ることになる（`moveEventOutcome()` と同じ考え方）。
 */
export async function moveEventNotificationSetting(
  userId: string,
  eventId: string,
  calendarId: string,
): Promise<void> {
  await db.eventNotificationSetting.updateMany({ where: { userId, eventId }, data: { calendarId } });
}

/**
 * 通知の下書きを作り直させる（docs/spec.md §32）。
 *
 * 下書きは30分ごとにしか作り直されない。設定を変えても、その時点で作られている下書きは
 * そのまま残る。作った印（plannedAt）を消しておけば、次の毎分のtickで作り直される
 * （通知設定変更時・中止不参加の記録と同じ扱い）。設定そのものは保存できているため、
 * ここで落ちても応答は失敗にしない。
 */
async function replanNotifications(userId: string): Promise<void> {
  try {
    await db.notificationSetting.updateMany({ where: { userId }, data: { plannedAt: null } });
  } catch (error) {
    console.error("[dayspan] event notification setting: replan failed:", error);
  }
}

/**
 * 予定を消したときに、その予定に付いていた上書き設定も消す（指す先が無くなるため）。
 *
 * 繰り返しの範囲指定は `dropOutcomesForEvent()`（services/calendar/event-outcomes.ts）と
 * 同じ扱いにする。回のIDは `<親のID>_YYYYMMDDTHHMMSSZ` で桁が揃っているため、文字列の
 * 大小で前後を比べられる。
 */
export async function dropNotificationSettingsForEvent(
  userId: string,
  eventId: string,
  scope: "single" | "following" | "all",
): Promise<number> {
  const separator = eventId.indexOf("_");

  if (scope === "single" || separator < 0) {
    const result = await db.eventNotificationSetting.deleteMany({ where: { userId, eventId } });
    return result.count;
  }

  const prefix = `${eventId.slice(0, separator)}_`;
  const result = await db.eventNotificationSetting.deleteMany({
    where: {
      userId,
      eventId: scope === "all" ? { startsWith: prefix } : { startsWith: prefix, gte: eventId },
    },
  });

  return result.count;
}

/** 移動を消したときに、その移動の通知設定も消す（issue #1112）。 */
export async function dropNotificationSettingForTravel(
  userId: string,
  travelId: string,
): Promise<void> {
  await db.eventNotificationSetting.deleteMany({
    where: { userId, eventId: travelNotificationKey(travelId) },
  });
}

/** 移動へ通知設定を付ける。設定の無い移動はそのまま。 */
export function attachTravelNotificationSettings<T extends { id: string }>(
  travels: T[],
  settings: EventNotificationSetting[],
): (T & { notification?: EventNotificationOverride | null })[] {
  if (settings.length === 0) return travels;

  const byKey = new Map(settings.map((setting) => [setting.eventId, setting]));

  return travels.map((travel) => {
    const setting = byKey.get(travelNotificationKey(travel.id));
    return setting ? { ...travel, notification: toEventNotificationOverride(setting) } : travel;
  });
}
